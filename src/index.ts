#!/usr/bin/env bun

import { logger } from './utils/logger.util';
import { RepoGraphError } from './utils/error.util';
// High-Level API for simple use cases
import { generateMap as executeGenerateMap } from './high-level';
import { type RepoGraphOptions as IRepoGraphOptions } from './types';

export { analyzeProject, generateMap } from './high-level';
export { initializeParser } from './tree-sitter/languages';

// Low-Level API for composition and advanced use cases
export { createMapGenerator } from './composer';

// Default pipeline component factories
export { createDefaultDiscoverer } from './pipeline/discover';
export { createTreeSitterAnalyzer } from './pipeline/analyze';
export { createPageRanker, createGitRanker } from './pipeline/rank';
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
  FileDiscoverer,
} from './types';

// This section runs only when the script is executed directly from the CLI
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const isRunningDirectly = () => {
  if (typeof process.argv[1] === 'undefined') return false;
  const runningFile = path.resolve(process.argv[1]);
  const currentFile = fileURLToPath(import.meta.url);
  return runningFile === currentFile;
};

const copyWasmFiles = async (destination: string) => {
  const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
  if (isBrowser) {
    logger.error('File system operations are not available in the browser.');
    return;
  }

  try {
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');

    // Source is relative to the running script (dist/index.js)
    const sourceDir = path.resolve(fileURLToPath(import.meta.url), '..', 'wasm');

    await fs.mkdir(destination, { recursive: true });

    const wasmFiles = (await fs.readdir(sourceDir)).filter(file => file.endsWith('.wasm'));
    for (const file of wasmFiles) {
      const srcPath = path.join(sourceDir, file);
      const destPath = path.join(destination, file);
      await fs.copyFile(srcPath, destPath);
      logger.info(`Copied ${file} to ${path.relative(process.cwd(), destPath)}`);
    }
    logger.info(`\n✅ All ${wasmFiles.length} WASM files copied successfully.`);
  } catch (err) {
    logger.error('Error copying WASM files.', err);
  }
};

if (isRunningDirectly()) {
  (async () => {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
      console.log(`
Usage: repograph [root] [options]
       repograph copy-wasm [destination]

Commands:
  [root]                   Analyze a repository at the given root path. This is the default command.
  copy-wasm [destination]  Copy the necessary Tree-sitter WASM files to a specified directory
                           for browser-based usage.
                           (default destination: "./public/wasm")

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
  --max-workers <num>      Set the maximum number of parallel workers for analysis. (default: 1)
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

    if (args[0] === 'copy-wasm') {
      const destDir = args[1] || './public/wasm';
      logger.info(`Copying WASM files to "${path.resolve(destDir)}"...`);
      await copyWasmFiles(destDir);
      process.exit(0);
    }

    if (args.includes('--version') || args.includes('-v')) {
      const { readFileSync } = await import('node:fs');
      const pkgPath = new URL('../package.json', import.meta.url);
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      console.log(pkg.version);
      process.exit(0);
    }

    const options: any = {};
    const includePatterns: string[] = [];
    const ignorePatterns: string[] = [];
    const rendererOptions: any = {};
    const symbolDetailOptions: any = {};

    const argConfig: Record<string, (val?: string) => void> = {
      '--output': val => options.output = val,
      '--include': val => val && includePatterns.push(val),
      '--ignore': val => val && ignorePatterns.push(val),
      '--no-gitignore': () => options.noGitignore = true,
      '--ranking-strategy': val => options.rankingStrategy = val as any,
      '--max-workers': val => options.maxWorkers = parseInt(val!, 10),
      '--log-level': val => options.logLevel = val as any,
      '--no-header': () => rendererOptions.includeHeader = false,
      '--no-overview': () => rendererOptions.includeOverview = false,
      '--no-mermaid': () => rendererOptions.includeMermaidGraph = false,
      '--no-file-list': () => rendererOptions.includeFileList = false,
      '--no-symbol-details': () => rendererOptions.includeSymbolDetails = false,
      '--top-file-count': val => rendererOptions.topFileCount = parseInt(val!, 10),
      '--file-section-separator': val => rendererOptions.fileSectionSeparator = val,
      '--no-symbol-relations': () => symbolDetailOptions.includeRelations = false,
      '--no-symbol-line-numbers': () => symbolDetailOptions.includeLineNumber = false,
      '--no-symbol-snippets': () => symbolDetailOptions.includeCodeSnippet = false,
      '--max-relations-to-show': val => symbolDetailOptions.maxRelationsToShow = parseInt(val!, 10),
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      const handler = argConfig[arg];
      if (handler) {
        // Check if handler takes a value
        if (handler.length === 1) {
          handler(args[++i]);
        } else {
          handler();
        }
      } else if (!arg.startsWith('-')) {
        options.root = arg;
      }
    }

    if (includePatterns.length > 0) {
      options.include = includePatterns;
    }
    
    if (ignorePatterns.length > 0) {
      options.ignore = ignorePatterns;
    }
    
    if (Object.keys(symbolDetailOptions).length > 0) {
      rendererOptions.symbolDetailOptions = symbolDetailOptions;
    }
    
    if (Object.keys(rendererOptions).length > 0) {
      options.rendererOptions = rendererOptions;
    }

    const finalOutput = path.resolve(options.root || process.cwd(), options.output || 'repograph.md');

    logger.info(`Starting RepoGraph analysis for "${path.resolve(options.root || process.cwd())}"...`);

    try {
      // Cast to the correct type for execution
      await executeGenerateMap(options as IRepoGraphOptions);
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
