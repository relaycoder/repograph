#!/usr/bin/env bun

// High-Level API for simple use cases
import { generateMap as executeGenerateMap } from './high-level.js';
import type { RepoGraphOptions as IRepoGraphOptions } from './types.js';

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
    `);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    // In a real app, you'd get this from package.json
    console.log('0.1.0');
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
    rendererOptions?: IRepoGraphOptions['rendererOptions'];
  } = {};
  const includePatterns: string[] = [];
  const ignorePatterns: string[] = [];

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

  executeGenerateMap(options)
    .then(() => {
      console.log(`✅ RepoGraph map generated successfully at ${path.resolve(options.root || process.cwd(), options.output || 'repograph.md')}`);
    })
    .catch((error: unknown) => {
      if (error instanceof Error) {
        console.error(`❌ Error generating RepoGraph map: ${error.message}`);
      } else {
        console.error('❌ An unknown error occurred while generating the RepoGraph map.');
      }
      process.exit(1);
    });
}