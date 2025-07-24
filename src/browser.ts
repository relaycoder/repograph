// Browser-compatible entry point for repograph
// Only exports functions that work in the browser environment

// High-level API - analyzeProject works in browser when files are provided
export { analyzeProject } from './high-level';
export { initializeParser } from './tree-sitter/languages';

// Browser-compatible pipeline components only
export { createTreeSitterAnalyzer } from './pipeline/analyze';
export { createPageRanker } from './pipeline/rank';
export { createMarkdownRenderer } from './pipeline/render';

// Logger utilities
export { logger } from './utils/logger.util';
export type { LogLevel, Logger } from './utils/logger.util';
export type { ParserInitializationOptions } from './tree-sitter/languages';

// Core types for building custom components
export type {
  Analyzer,
  FileContent,
  CodeNode,
  CodeNodeType,
  CodeNodeVisibility,
  CodeEdge,
  CodeGraph,
  RankedCodeGraph,
  RepoGraphMap,
  RepoGraphOptions,
  CssIntent,
  Ranker,
  Renderer,
  RendererOptions,
} from './types';