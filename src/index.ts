#!/usr/bin/env bun
import { logger, RepoGraphError } from 'repograph-core';
import { generateMap as executeGenerateMap, type RepoGraphOptions as IRepoGraphOptions } from './high-level';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Export full API for library usage
export { generateMap, analyzeProject, type RepoGraphOptions } from './high-level';
export { createMapGenerator } from './composer';
export { createDefaultDiscoverer } from './pipeline/discover';
export { createTreeSitterAnalyzer } from './pipeline/analyze';
export { initializeParser } from './tree-sitter/languages';
export { createGitRanker } from './pipeline/rank';
export * from 'repograph-core';

// --- CLI LOGIC ---
const isRunningDirectly = () => {
  if (typeof process.argv[1] === 'undefined') return false;
  const runningFile = path.resolve(process.argv[1]);
  const currentFile = fileURLToPath(import.meta.url);
  return runningFile === currentFile;
};

const copyWasmFiles = async (destination: string) => {
  try {
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');

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

    const options: {
      root?: string;
      output?: string;
      include?: readonly string[];
      ignore?: readonly string[];
      noGitignore?: boolean;
      maxWorkers?: number;
      rankingStrategy?: 'pagerank' | 'git-changes';
      logLevel?: IRepoGraphOptions['logLevel'];
      rendererOptions?: IRepoGraphOptions['rendererOptions'];
    } = {};
    const includePatterns: string[] = [];
    const ignorePatterns: string[] = [];
    const rendererOptions: NonNullable<IRepoGraphOptions['rendererOptions']> = {};

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;
      switch (arg) {
        case '--output': options.output = args[++i]; break;
        case '--include': includePatterns.push(args[++i] as string); break;
        case '--ignore': ignorePatterns.push(args[++i] as string); break;
        case '--no-gitignore': options.noGitignore = true; break;
        case '--ranking-strategy': options.rankingStrategy = args[++i] as any; break;
        case '--max-workers': options.maxWorkers = parseInt(args[++i] as string, 10); break;
        case '--log-level': options.logLevel = args[++i] as any; break;
        case '--no-header': rendererOptions.includeHeader = false; break;
        case '--no-overview': rendererOptions.includeOverview = false; break;
        case '--no-mermaid': rendererOptions.includeMermaidGraph = false; break;
        case '--no-file-list': rendererOptions.includeFileList = false; break;
        case '--no-symbol-details': rendererOptions.includeSymbolDetails = false; break;
        case '--top-file-count': rendererOptions.topFileCount = parseInt(args[++i] as string, 10); break;
        case '--file-section-separator': rendererOptions.fileSectionSeparator = args[++i]; break;
        case '--no-symbol-relations':
          rendererOptions.symbolDetailOptions = { ...(rendererOptions.symbolDetailOptions || {}), includeRelations: false }; break;
        case '--no-symbol-line-numbers':
          rendererOptions.symbolDetailOptions = { ...(rendererOptions.symbolDetailOptions || {}), includeLineNumber: false }; break;
        case '--no-symbol-snippets':
          rendererOptions.symbolDetailOptions = { ...(rendererOptions.symbolDetailOptions || {}), includeCodeSnippet: false }; break;
        case '--max-relations-to-show':
          rendererOptions.symbolDetailOptions = { ...(rendererOptions.symbolDetailOptions || {}), maxRelationsToShow: parseInt(args[++i] as string, 10) }; break;
        default: if (!arg.startsWith('-')) options.root = arg; break;
      }
    }

    if (includePatterns.length > 0) options.include = includePatterns;
    if (ignorePatterns.length > 0) options.ignore = ignorePatterns;
    if (Object.keys(rendererOptions).length > 0) options.rendererOptions = rendererOptions;

    const finalOutput = path.resolve(options.root || process.cwd(), options.output || 'repograph.md');
    logger.info(`Starting RepoGraph analysis for "${path.resolve(options.root || process.cwd())}"...`);

    try {
      await executeGenerateMap(options);
      logger.info(`\n✅ Success! RepoGraph map saved to ${path.relative(process.cwd(), finalOutput)}`);
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
