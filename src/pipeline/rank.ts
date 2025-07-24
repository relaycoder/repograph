import pagerank from 'graphology-pagerank';
import Graph from 'graphology';
import type { CodeGraph, Ranker, RankedCodeGraph } from '../types';

import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.util';

/**
 * Creates a ranker that uses the PageRank algorithm. Nodes that are heavily referenced by
 * other important nodes will receive a higher rank.
 * @returns A Ranker function.
 */
export const createPageRanker = (): Ranker => {
  return async (graph: CodeGraph): Promise<RankedCodeGraph> => {
    // PageRank can only be computed on graphs with nodes.
    if (graph.nodes.size === 0) {
      return { ...graph, ranks: new Map() };
    }

    // Convert CodeGraph to graphology Graph
    const graphologyGraph = new Graph();
    
    // Add all nodes
    for (const [nodeId] of graph.nodes) {
      (graphologyGraph as any).addNode(nodeId);
    }
    
    // Add all edges
    for (const edge of graph.edges) {
      // Only add edge if both nodes exist
      if ((graphologyGraph as any).hasNode(edge.fromId) && (graphologyGraph as any).hasNode(edge.toId)) {
        try {
          (graphologyGraph as any).addEdge(edge.fromId, edge.toId);
        } catch (error) {
          // Edge might already exist, ignore duplicate edge errors
        }
      }
    }
    
    const ranksData = pagerank(graphologyGraph);
    const ranks = new Map<string, number>();
    for (const node in ranksData) {
      ranks.set(node, ranksData[node] ?? 0);
    }
    return { ...graph, ranks };
  };
};

/**
 * Creates a ranker based on Git commit history. Files changed more frequently are considered
 * more important. Requires Git to be installed.
 * @returns A Ranker function.
 */
export const createGitRanker = (options: { maxCommits?: number } = {}): Ranker => {
  return async (graph: CodeGraph): Promise<RankedCodeGraph> => {
    const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
    if (isBrowser) {
      logger.warn('GitRanker is not supported in the browser. Returning 0 for all ranks.');
      const ranks = new Map<string, number>();
      for (const [nodeId] of graph.nodes) {
        ranks.set(nodeId, 0);
      }
      return { ...graph, ranks };
    }

    const { maxCommits = 500 } = options;
    const ranks = new Map<string, number>();

    if (graph.nodes.size === 0) {
      return { ...graph, ranks };
    }

    try {
      const command = `git log --max-count=${maxCommits} --name-only --pretty=format:`;
      const output = execSync(command, { encoding: 'utf-8' });
      const files = output.split('\n').filter(Boolean);

      const changeCounts: Record<string, number> = {};
      for (const file of files) {
        changeCounts[file] = (changeCounts[file] || 0) + 1;
      }

      const maxChanges = Math.max(...Object.values(changeCounts), 1);

      for (const [nodeId, attributes] of graph.nodes) {
        // We only rank file nodes with this strategy
        if (attributes.type === 'file') {
          const count = changeCounts[attributes.filePath] ?? 0;
          ranks.set(nodeId, count / maxChanges); // Normalize score
        } else {
          ranks.set(nodeId, 0);
        }
      }
    } catch (e) {
      // This is not a fatal error for the whole process, but this ranker cannot proceed.
      logger.warn('Failed to use \'git\' for ranking. Is git installed and is this a git repository? Returning 0 for all ranks.');
      for (const [nodeId] of graph.nodes) {
        ranks.set(nodeId, 0);
      }
    }

    return { ...graph, ranks };
  };
};