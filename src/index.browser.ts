import { logger } from './utils/logger.util';
import { RepoGraphError } from './utils/error.util';
// High-Level API for simple use cases
import { generateMapFromMemory, analyzeProjectFromMemory } from './high-level.browser';
import type { RepoGraphOptions as IRepoGraphOptions } from './types';

export { generateMapFromMemory, analyzeProjectFromMemory };

// Low-Level API for composition and advanced use cases
export { createMapGenerator } from './composer';

// Default pipeline component factories
export { createDefaultDiscoverer } from './pipeline/discover.browser';
export { createTreeSitterAnalyzer } from './pipeline/analyze.browser';
export { createPageRanker } from './pipeline/rank';
export { createMarkdownRenderer } from './pipeline/render';

// Logger utilities
export { logger } from './utils/logger.util';
export type { Logger, LogLevel } from './utils/logger.util';

// Core types for building custom components
export type {
  FileContent,
  CodeNode,
  CodeNodeType,
  CodeNodeVisibility,
  CodeEdge,
  CodeGraph,
  RankedCodeGraph,
  RepoGraphMap,
  RepoGraphOptions,
  RendererOptions,
  FileDiscoverer,
  CssIntent,
  Analyzer,
  Ranker,
  Renderer,
} from './types';

// Browser environment detection
export const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
export const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;