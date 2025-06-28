// High-Level API for simple use cases
export { generateMap } from './high-level.js';

// Low-Level API for composition and advanced use cases
export { createMapGenerator } from './composer.js';

// Default pipeline component factories
export { createDefaultDiscoverer } from './pipeline/discover.js';
export { createTreeSitterAnalyzer } from './pipeline/analyze.js';
export { createPageRanker, createGitRanker } from './pipeline/rank.js';
export { createMarkdownRenderer } from './pipeline/render.js';

// Core types for building custom components
export type {
  FileContent,
  CodeNode,
  CodeNodeType,
  CodeEdge,
  CodeGraph,
  RankedCodeGraph,
  RepoGraphOptions,
  RendererOptions,
  FileDiscoverer,
  Analyzer,
  Ranker,
  Renderer,
} from './types.js';