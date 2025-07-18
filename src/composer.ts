import path from 'node:path';
import type { Analyzer, FileDiscoverer, Ranker, Renderer, RepoGraphMap } from './types.js';
import { logger } from './utils/logger.util.js';
import { writeFile } from './utils/fs.util.js';

type MapGenerator = (config: {
  readonly root: string;
  readonly output?: string;
  readonly include?: readonly string[];
  readonly ignore?: readonly string[];
  readonly noGitignore?: boolean;
  readonly rendererOptions?: any;
}) => Promise<RepoGraphMap>;

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

    try {
      logger.info('1/4 Discovering files...');
      const files = await pipeline.discover({ root, include, ignore, noGitignore });
      logger.info(`  -> Found ${files.length} files to analyze.`);

      try {
        logger.info('2/4 Analyzing code and building graph...');
        const graph = await pipeline.analyze(files);
        logger.info(`  -> Built graph with ${graph.nodes.size} nodes and ${graph.edges.length} edges.`);

        try {
          logger.info('3/4 Ranking graph nodes...');
          const rankedGraph = await pipeline.rank(graph);
          logger.info('  -> Ranking complete.');

          try {
            logger.info('4/4 Rendering output...');
            const markdown = pipeline.render(rankedGraph, rendererOptions);
            logger.info('  -> Rendering complete.');

            if (output) {
              const outputPath = path.isAbsolute(output) ? output : path.resolve(root, output);
              logger.info(`Writing report to ${path.relative(process.cwd(), outputPath)}...`);
              await writeFile(outputPath, markdown);
              logger.info('  -> Report saved.');
            }

            return { graph: rankedGraph, markdown };
          } catch (error) {
            throw new Error(`Error in render stage: ${error instanceof Error ? error.message : String(error)}`);
          }
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Error in render stage:')) {
            throw error;
          }
          throw new Error(`Error in rank stage: ${error instanceof Error ? error.message : String(error)}`);
        }
      } catch (error) {
        if (error instanceof Error && (error.message.startsWith('Error in rank stage:') || error.message.startsWith('Error in render stage:'))) {
          throw error;
        }
        throw new Error(`Error in analyze stage: ${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (error) {
      if (error instanceof Error && (error.message.startsWith('Error in analyze stage:') || error.message.startsWith('Error in rank stage:') || error.message.startsWith('Error in render stage:'))) {
        throw error;
      }
      throw new Error(`Error in discover stage: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
};