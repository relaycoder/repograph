declare module 'graphology-pagerank' {
  import type Graph from 'graphology';

  export default function pagerank<T = any>(graph: Graph<T>, options?: {
    alpha?: number;
    tolerance?: number;
    maxIterations?: number;
    getEdgeWeight?: (edge: string) => number;
  }): Record<string, number>;
}
