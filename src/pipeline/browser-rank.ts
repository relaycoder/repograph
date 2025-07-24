import pagerank from 'graphology-pagerank';
import Graph from 'graphology';
import type { CodeGraph, Ranker, RankedCodeGraph } from '../types';


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
 * Git ranker is not available in browser environment.
 * This function throws an error if called.
 */
export const createGitRanker = (): Ranker => {
  return async (): Promise<RankedCodeGraph> => {
    throw new Error('GitRanker is not supported in the browser environment. Use PageRank instead.');
  };
};