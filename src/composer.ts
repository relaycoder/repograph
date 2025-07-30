import type { Analyzer, FileDiscoverer, Ranker, RepoGraphMap, Renderer } from 'repograph-core';
import { logger, RepoGraphError } from 'repograph-core';
import { writeFile } from './utils/fs.util';
import path from 'node:path';
import type { RepoGraphOptions } from './high-level';

type MapGenerator = (config: RepoGraphOptions & { root: string }) => Promise<RepoGraphMap>;

/**
 * A Higher-Order Function that takes pipeline functions as arguments and
 * returns a fully configured `generate` function for creating a codemap.
 * This is the core of RepoGraph's composability.
 *
 * @param pipeline An object containing implementations for each pipeline stage.
 * @returns An asynchronous function to generate and write the codemap.
 */
export const createMapGenerator = (pipeline: {
  readonly discover: FileDiscoverer;
  readonly analyze: Analyzer;
  readonly rank: Ranker;
  readonly render: Renderer;
}): MapGenerator => {
  if (
    !pipeline ||
    typeof pipeline.discover !== 'function' ||
    typeof pipeline.analyze !== 'function' ||
    typeof pipeline.rank !== 'function' ||
    typeof pipeline.render !== 'function'
  ) {
    throw new Error('createMapGenerator: A valid pipeline object with discover, analyze, rank, and render functions must be provided.');
  }
  return async (config) => {
    const { root, output, include, ignore, noGitignore, rendererOptions } = config;

    let stage = 'discover';
    try {
      logger.info('1/4 Discovering files...');
      const files = await pipeline.discover({ root, include, ignore, noGitignore });
      logger.debug(`  -> Found ${files.length} files to analyze.`);

      stage = 'analyze';
      logger.info('2/4 Analyzing code and building graph...');
      const graph = await pipeline.analyze(files);
      logger.debug(`  -> Built graph with ${graph.nodes.size} nodes and ${graph.edges.length} edges.`);

      stage = 'rank';
      logger.info('3/4 Ranking graph nodes...');
      const rankedGraph = await pipeline.rank(graph);
      logger.debug('  -> Ranking complete.');

      stage = 'render';
      logger.info('4/4 Rendering output...');
      const markdown = pipeline.render(rankedGraph, rendererOptions);
      logger.debug('  -> Rendering complete.');

      if (output) {
        const outputPath = path.isAbsolute(output) ? output : path.resolve(root, output);
        stage = 'write';
        logger.info(`Writing report to ${path.relative(process.cwd(), outputPath)}...`);
        await writeFile(outputPath, markdown);
        logger.info('  -> Report saved.');
      }

      return { graph: rankedGraph, markdown };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stageErrorMessage = stage === 'write' ? `Failed to write output file` : `Error in ${stage} stage`;
      throw new RepoGraphError(`${stageErrorMessage}: ${message}`, error);
    }
  };
};