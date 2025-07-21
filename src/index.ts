#!/usr/bin/env bun

import { logger } from './utils/logger.util.js';
import { RepoGraphError } from './utils/error.util.js';
// High-Level API for simple use cases
import { generateMap as executeGenerateMap } from './high-level.js';
import type { RepoGraphOptions as IRepoGraphOptions } from './types.js';

export { generateMap, analyzeProject } from './high-level.js';

// Low-Level API for composition and advanced use cases
export { createMapGenerator } from './composer.js';

// Default pipeline component factories
export { createDefaultDiscoverer } from './pipeline/discover.js';
export { createTreeSitterAnalyzer } from './pipeline/analyze.js';
export { createPageRanker, createGitRanker } from './pipeline/rank.js';
export { createMarkdownRenderer } from './pipeline/render.js';

// Logger utilities
export { logger } from './utils/logger.util.js';
export type { Logger, LogLevel } from './utils/logger.util.js';

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
} from './types.js';

// This section runs only when the script is executed directly from the CLI
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const isRunningDirectly = () => {
  if (typeof process.argv[1] === 'undefined') return false;
  const runningFile = path.resolve(process.argv[1]);
  const currentFile = fileURLToPath(import.meta.url);
  return runningFile === currentFile;
};

if (isRunningDirectly()) {
  (async () => {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
      console.log(`
Usage: repograph [root] [options]

Arguments:
  root                     The root directory of the repository to analyze. Defaults to the current working directory.

Options:
  -h, --help               Display this help message.
  -v, --version            Display the version number.
  --output <path>          Path to the output Markdown file. (default: "repograph.md")
  --include <pattern>      Glob pattern for files to include. Can be specified multiple times.
  --ignore <pattern>       Glob pattern for files to ignore. Can be specified multiple times.
  --no-gitignore           Do not respect .gitignore files.
  --ranking-strategy <name> The ranking strategy to use. (default: "pagerank", options: "pagerank", "git-changes")
  --log-level <level>      Set the logging level. (default: "info", options: "silent", "error", "warn", "info", "debug")

Output Formatting:
  --no-header              Do not include the main "RepoGraph" header.
  --no-overview            Do not include the project overview section.
  --no-mermaid             Do not include the Mermaid dependency graph.
  --no-file-list           Do not include the list of top-ranked files.
  --no-symbol-details      Do not include the detailed file and symbol breakdown.
  --top-file-count <num>   Set the number of files in the top list. (default: 10)
  --file-section-separator <str> Custom separator for file sections. (default: "---")
  --no-symbol-relations    Hide symbol relationship details (e.g., calls, implements).
  --no-symbol-line-numbers Hide line numbers for symbols.
  --no-symbol-snippets     Hide code snippets for symbols.
  --max-relations-to-show <num> Max number of 'calls' relations to show per symbol. (default: 3)
    `);
      process.exit(0);
    }

    if (args.includes('--version') || args.includes('-v')) {
      const { readFileSync } = await import('node:fs');
      const pkgPath = new URL('../package.json', import.meta.url);
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      console.log(pkg.version);
      process.exit(0);
    }

    // We need a mutable version of the options to build it from arguments.
    const options: {
      root?: string;
      output?: string;
      include?: readonly string[];
      ignore?: readonly string[];
      noGitignore?: boolean;
      rankingStrategy?: 'pagerank' | 'git-changes';
      logLevel?: IRepoGraphOptions['logLevel'];
      rendererOptions?: IRepoGraphOptions['rendererOptions'];
    } = {};
    const includePatterns: string[] = [];
    const ignorePatterns: string[] = [];
    // We need a mutable version of rendererOptions to build from CLI args
    const rendererOptions: {
      customHeader?: string;
      includeHeader?: boolean;
      includeOverview?: boolean;
      includeMermaidGraph?: boolean;
      includeFileList?: boolean;
      topFileCount?: number;
      includeSymbolDetails?: boolean;
      fileSectionSeparator?: string;
      symbolDetailOptions?: {
        includeRelations?: boolean;
        includeLineNumber?: boolean;
        includeCodeSnippet?: boolean;
        maxRelationsToShow?: number;
      };
    } = {};

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) {
        continue;
      }
      switch (arg) {
        case '--output':
          options.output = args[++i];
          break;
        case '--include':
          includePatterns.push(args[++i] as string);
          break;
        case '--ignore':
          ignorePatterns.push(args[++i] as string);
          break;
        case '--no-gitignore':
          options.noGitignore = true;
          break;
        case '--ranking-strategy':
          options.rankingStrategy = args[++i] as IRepoGraphOptions['rankingStrategy'];
          break;
        case '--log-level':
          options.logLevel = args[++i] as IRepoGraphOptions['logLevel'];
          break;
        // --- Renderer Options ---
        case '--no-header':
          rendererOptions.includeHeader = false;
          break;
        case '--no-overview':
          rendererOptions.includeOverview = false;
          break;
        case '--no-mermaid':
          rendererOptions.includeMermaidGraph = false;
          break;
        case '--no-file-list':
          rendererOptions.includeFileList = false;
          break;
        case '--no-symbol-details':
          rendererOptions.includeSymbolDetails = false;
          break;
        case '--top-file-count':
          rendererOptions.topFileCount = parseInt(args[++i] as string, 10);
          break;
        case '--file-section-separator':
          rendererOptions.fileSectionSeparator = args[++i];
          break;
        case '--no-symbol-relations':
          rendererOptions.symbolDetailOptions = { ...(rendererOptions.symbolDetailOptions || {}), includeRelations: false };
          break;
        case '--no-symbol-line-numbers':
          rendererOptions.symbolDetailOptions = { ...(rendererOptions.symbolDetailOptions || {}), includeLineNumber: false };
          break;
        case '--no-symbol-snippets':
          rendererOptions.symbolDetailOptions = { ...(rendererOptions.symbolDetailOptions || {}), includeCodeSnippet: false };
          break;
        case '--max-relations-to-show':
          rendererOptions.symbolDetailOptions = { ...(rendererOptions.symbolDetailOptions || {}), maxRelationsToShow: parseInt(args[++i] as string, 10) };
          break;
        default:
          if (!arg.startsWith('-')) {
            options.root = arg;
          }
          break;
      }
    }

    if (includePatterns.length > 0) {
      options.include = includePatterns;
    }
    if (ignorePatterns.length > 0) {
      options.ignore = ignorePatterns;
    }
    if (Object.keys(rendererOptions).length > 0) {
      options.rendererOptions = rendererOptions;
    }

    const finalOutput = path.resolve(options.root || process.cwd(), options.output || 'repograph.md');

    logger.info(`Starting RepoGraph analysis for "${path.resolve(options.root || process.cwd())}"...`);

    try {
      await executeGenerateMap(options);
      const relativePath = path.relative(process.cwd(), finalOutput);
      logger.info(`\n✅ Success! RepoGraph map saved to ${relativePath}`);
    } catch (error: unknown) {
      if (error instanceof RepoGraphError) {
        logger.error(`\n❌ Error generating RepoGraph map: ${error.message}`);
      } else {
        logger.error('\n❌ An unknown error occurred while generating the RepoGraph map.', error);
      }
      process.exit(1);
    }
  })().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
