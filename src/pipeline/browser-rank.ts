import pagerank from 'graphology-pagerank';
import type { CodeGraph, Ranker, RankedCodeGraph } from '../types';
import Graph from 'graphology';

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

    // Pagerank lib requires a graphology instance.
    const simpleGraph = new Graph({ type: 'directed' });
    for (const [nodeId, node] of graph.nodes) {
      simpleGraph.addNode(nodeId, node);
    }
    for (const edge of graph.edges) {
      if (!simpleGraph.hasEdge(edge.fromId, edge.toId)) {
        simpleGraph.addDirectedEdge(edge.fromId, edge.toId);
      }
    }

    const graphForRank = simpleGraph;
    const ranksData = pagerank(graphForRank);
    const ranks = new Map<string, number>();
    for (const node in ranksData) {
      ranks.set(node, ranksData[node] ?? 0);
    }
    return { ...graph, ranks };
  };
};

/**
 * Git ranker is not available in browser environment.
 * This function throws an error if called.
 */
export const createGitRanker = (): Ranker => {
  return async (): Promise<RankedCodeGraph> => {
    throw new Error('GitRanker is not supported in the browser environment. Use PageRank instead.');
  };
};