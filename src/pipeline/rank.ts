import { pagerank } from 'graphology-pagerank';
import type { CodeGraph, Ranker, RankedCodeGraph } from '../types.js';
import { execSync } from 'node:child_process';

/**
 * Creates a ranker that uses the PageRank algorithm. Nodes that are heavily
 * referenced by other important nodes will receive a higher rank.
 * @returns A Ranker function.
 */
export const createPageRanker = (): Ranker => {
  return async (graph: CodeGraph): Promise<RankedCodeGraph> => {
    // PageRank can only be computed on graphs with nodes.
    if (graph.order === 0) {
      return { graph, ranks: new Map() };
    }
    const ranksData = pagerank(graph);
    const ranks = new Map<string, number>();
    for (const node in ranksData) {
      ranks.set(node, ranksData[node] ?? 0);
    }
    return { graph, ranks };
  };
};

/**
 * Creates a ranker based on Git commit history. Files changed more frequently
 * are considered more important. Requires Git to be installed.
 * @returns A Ranker function.
 */
export const createGitRanker = (options: { maxCommits?: number } = {}): Ranker => {
  return async (graph: CodeGraph): Promise<RankedCodeGraph> => {
    const { maxCommits = 500 } = options;
    const ranks = new Map<string, number>();
    
    try {
      const command = `git log --max-count=${maxCommits} --name-only --pretty=format:`;
      const output = execSync(command, { encoding: 'utf-8' });
      const files = output.split('\n').filter(Boolean);

      const changeCounts: Record<string, number> = {};
      for (const file of files) {
        changeCounts[file] = (changeCounts[file] || 0) + 1;
      }
      
      const maxChanges = Math.max(...Object.values(changeCounts), 1);
      
      graph.forEachNode((nodeId, attributes) => {
        // We only rank file nodes with this strategy
        if (attributes.type === 'file') {
          const count = changeCounts[attributes.filePath] || 0;
          ranks.set(nodeId, count / maxChanges); // Normalize score
        } else {
          ranks.set(nodeId, 0);
        }
      });

    } catch (e) {
      console.warn('Git command failed. Could not generate git-based ranks. Is git installed?');
      graph.forEachNode((nodeId) => ranks.set(nodeId, 0));
    }
    
    return { graph, ranks };
  };
};