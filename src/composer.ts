import fs from 'node:fs/promises';
import path from 'node:path';
import type { Analyzer, FileDiscoverer, Ranker, Renderer } from './types.js';

type MapGenerator = (config: {
  readonly root: string;
  readonly output: string;
  readonly include?: readonly string[];
  readonly ignore?: readonly string[];
  readonly noGitignore?: boolean;
  readonly rendererOptions?: any;
}) => Promise<void>;

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

    // 1. Discover
    const files = await pipeline.discover({ root, include, ignore, noGitignore });

    // 2. Analyze
    const graph = await pipeline.analyze(files);

    // 3. Rank
    const rankedGraph = await pipeline.rank(graph);

    // 4. Render
    const markdown = pipeline.render(rankedGraph, rendererOptions);

    // 5. Write to disk
    const outputPath = path.isAbsolute(output) ? output : path.resolve(root, output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, markdown);
  };
};