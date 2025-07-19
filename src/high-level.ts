import { createMapGenerator } from './composer.js';
import { createDefaultDiscoverer } from './pipeline/discover.js';
import { createTreeSitterAnalyzer } from './pipeline/analyze.js';
import { createPageRanker, createGitRanker } from './pipeline/rank.js';
import { createMarkdownRenderer } from './pipeline/render.js';
import type { RepoGraphOptions, Ranker } from './types.js';
import path from 'node:path';
import { logger } from './utils/logger.util.js';

/**
 * The primary, easy-to-use entry point for RepoGraph. It orchestrates the
 * default pipeline based on a configuration object to generate a codemap.
 *
 * @param options The configuration object for generating the map.
 */
export const generateMap = async (options: RepoGraphOptions = {}): Promise<void> => {
  const {
    root = process.cwd(),
    output = './repograph.md',
    rankingStrategy = 'pagerank',
    logLevel = 'info',
  } = options;

  if (logLevel) {
    logger.setLevel(logLevel);
  }

  let ranker: Ranker;
  if (rankingStrategy === 'git-changes') {
    ranker = createGitRanker();
  } else if (rankingStrategy === 'pagerank') {
    ranker = createPageRanker();
  } else {
    throw new Error(`Invalid ranking strategy: '${rankingStrategy}'. Available options are 'pagerank', 'git-changes'.`);
  }

  const generator = createMapGenerator({
    discover: createDefaultDiscoverer(),
    analyze: createTreeSitterAnalyzer(),
    rank: ranker,
    render: createMarkdownRenderer(),
  });

  try {
    await generator({
      root: path.resolve(root),
      output: output,
      include: options.include,
      ignore: options.ignore,
      noGitignore: options.noGitignore,
      rendererOptions: options.rendererOptions,
    });
  } catch (error) {
    throw error; // Re-throw to ensure errors propagate properly
  }
};