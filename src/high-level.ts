import { createDefaultDiscoverer } from './pipeline/discover';
import { createTreeSitterAnalyzer } from './pipeline/analyze';
import { createGitRanker } from './pipeline/rank';
import { createPageRanker, createMarkdownRenderer, logger, RepoGraphError, type Ranker, type RankedCodeGraph, type FileContent } from 'repograph-core';
import path from 'node:path';
import { writeFile } from './utils/fs.util';

export type RepoGraphOptions = {
  root?: string;
  output?: string;
  include?: readonly string[];
  ignore?: readonly string[];
  noGitignore?: boolean;
  rankingStrategy?: 'pagerank' | 'git-changes';
  maxWorkers?: number;
  logLevel?: 'silent' | 'error' | 'warn' | 'info' | 'debug';
  rendererOptions?: import('repograph-core').RendererOptions;
  files?: readonly FileContent[];
};

const selectRanker = (rankingStrategy: RepoGraphOptions['rankingStrategy'] = 'pagerank'): Ranker => {
  if (rankingStrategy === 'git-changes') return createGitRanker();
  if (rankingStrategy === 'pagerank') return createPageRanker();
  throw new Error(`Invalid ranking strategy: '${rankingStrategy}'. Available options are 'pagerank', 'git-changes'.`);
};

export const analyzeProject = async (options: RepoGraphOptions = {}): Promise<RankedCodeGraph> => {
  const { root, logLevel, include, ignore, noGitignore, maxWorkers, files: inputFiles } = options;

  if (logLevel) {
    logger.setLevel(logLevel);
  }

  const ranker = selectRanker(options.rankingStrategy);

  try {
    let files: readonly FileContent[];
    if (inputFiles && inputFiles.length > 0) {
      logger.info('1/3 Using provided files...');
      files = inputFiles;
    } else {
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

export const generateMap = async (options: RepoGraphOptions = {}): Promise<void> => {
  const finalOptions = { ...options, logLevel: options.logLevel ?? 'info' };

  const {
    root = process.cwd(),
    output = './repograph.md',
  } = finalOptions;

  try {
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
    throw error;
  }
};