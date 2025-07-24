// Browser-compatible version of high-level.ts
import { createTreeSitterAnalyzer } from './pipeline/browser-analyze';
import { createPageRanker } from './pipeline/rank';
import type { RepoGraphOptions, Ranker, RankedCodeGraph, FileContent } from './types';
import { logger } from './utils/logger.util';
import { RepoGraphError } from './utils/error.util';

const selectRanker = (rankingStrategy: RepoGraphOptions['rankingStrategy'] = 'pagerank'): Ranker => {
  if (rankingStrategy === 'pagerank') {
    return createPageRanker();
  }
  // Git ranker is not available in browser
  throw new Error(`Invalid ranking strategy: '${rankingStrategy}'. Only 'pagerank' is available in browser environment.`);
};

/**
 * A mid-level API for programmatically generating and receiving the code graph
 * without rendering it to a file. Ideal for integration with other tools.
 * Browser-compatible version that requires files to be provided.
 *
 * @param options The configuration object for generating the map.
 * @returns The generated `RankedCodeGraph`.
 */
export const analyzeProject = async (options: RepoGraphOptions = {}): Promise<RankedCodeGraph> => {
  const { logLevel, maxWorkers, files: inputFiles } = options;

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
      throw new RepoGraphError('File discovery is not supported in the browser. Please provide the `files` option with file content.');
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