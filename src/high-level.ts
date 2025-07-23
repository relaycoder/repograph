import { createDefaultDiscoverer } from './pipeline/discover';
import { createTreeSitterAnalyzer } from './pipeline/analyze';
import { createPageRanker, createGitRanker } from './pipeline/rank';
import { createMarkdownRenderer } from './pipeline/render';
import type { RepoGraphOptions, Ranker, RankedCodeGraph, FileContent } from './types';
import path from 'node:path';
import { logger } from './utils/logger.util';
import { writeFile } from './utils/fs.util';
import { RepoGraphError } from './utils/error.util';

const selectRanker = (rankingStrategy: RepoGraphOptions['rankingStrategy'] = 'pagerank'): Ranker => {
  if (rankingStrategy === 'git-changes') {
    return createGitRanker();
  }
  if (rankingStrategy === 'pagerank') {
    return createPageRanker();
  }
  throw new Error(`Invalid ranking strategy: '${rankingStrategy}'. Available options are 'pagerank', 'git-changes'.`);
};

/**
 * A mid-level API for programmatically generating and receiving the code graph
 * without rendering it to a file. Ideal for integration with other tools.
 *
 * @param options The configuration object for generating the map.
 * @returns The generated `RankedCodeGraph`.
 */
export const analyzeProject = async (options: RepoGraphOptions = {}): Promise<RankedCodeGraph> => {
  const { root, logLevel, include, ignore, noGitignore, maxWorkers, files: inputFiles } = options;
  const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';

  if (logLevel) {
    logger.setLevel(logLevel);
  }

  // Validate options before entering the main try...catch block to provide clear errors.
  const ranker = selectRanker(options.rankingStrategy);

  try {
    let files: readonly FileContent[];
    if (inputFiles && inputFiles.length > 0) {
      logger.info('1/3 Using provided files...');
      files = inputFiles;
    } else {
      if (isBrowser) {
        throw new RepoGraphError('File discovery is not supported in the browser. Please provide the `files` option with file content.');
      }
      const effectiveRoot = root || process.cwd();
      logger.info(`1/3 Discovering files in "${effectiveRoot}"...`);
      const discoverer = createDefaultDiscoverer();
      files = await discoverer({ root: path.resolve(effectiveRoot), include, ignore, noGitignore });
    }
    logger.debug(`  -> Found ${files.length} files to analyze.`);

    logger.info('2/3 Analyzing code and building graph...');
    const analyzer = createTreeSitterAnalyzer({ maxWorkers });
    const graph = await analyzer(files);
    logger.debug(`  -> Built graph with ${graph.nodes.size} nodes and ${graph.edges.length} edges.`);

    logger.info('3/3 Ranking graph nodes...');
    const rankedGraph = await ranker(graph);
    logger.debug('  -> Ranking complete.');

    return rankedGraph;
  } catch (error) {
    throw new RepoGraphError(`Failed to analyze project`, error);
  }
};

/**
 * The primary, easy-to-use entry point for RepoGraph. It orchestrates the
 * default pipeline based on a configuration object to generate a codemap.
 *
 * @param options The configuration object for generating the map.
 */
export const generateMap = async (options: RepoGraphOptions = {}): Promise<void> => {
  const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
  if (isBrowser) {
    throw new RepoGraphError('`generateMap` is not supported in the browser because it cannot write to the file system. Use `analyzeProject` and a `Renderer` instead.');
  }

  const finalOptions = { ...options, logLevel: options.logLevel ?? 'info' };

  const {
    root = process.cwd(),
    output = './repograph.md',
  } = finalOptions;

  try {
    // We get the full ranked graph first
    const rankedGraph = await analyzeProject(finalOptions);

    logger.info('4/4 Rendering output...');
    const renderer = createMarkdownRenderer();
    const markdown = renderer(rankedGraph, finalOptions.rendererOptions);
    logger.debug('  -> Rendering complete.');

    const outputPath = path.isAbsolute(output) ? output : path.resolve(root, output);

    logger.info(`Writing report to ${path.relative(process.cwd(), outputPath)}...`);
    await writeFile(outputPath, markdown);
    logger.info('  -> Report saved.');
  } catch (error) {
    // The underlying `analyzeProject` already wraps the error, so we just re-throw.
    throw error;
  }
};