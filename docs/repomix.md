# Directory Structure
```
packages/
  repograph-browser/
    src/
      pipeline/
        browser-analyze.ts
      tree-sitter/
        browser-languages.ts
      utils/
        path.util.ts
      browser-high-level.ts
      index.ts
    package.json
    tsconfig.json
    tsup.config.ts
  repograph-web-demo/
    scripts/
      prepare-wasm.cjs
    src/
      components/
        ui/
          button.tsx
          card.tsx
          textarea.tsx
        LogViewer.tsx
      lib/
        utils.ts
      App.tsx
      default-files.ts
      index.css
      main.tsx
    package.json
    postcss.config.js
    tailwind.config.js
    tsconfig.json
    tsconfig.node.json
    vite.config.ts
  scn-ts-browser/
    src/
      index.ts
    package.json
    tsconfig.json
    tsup.config.ts
  scn-ts-core/
    src/
      index.ts
      serializer.ts
    package.json
    tsconfig.json
    tsup.config.ts
```

# Files

## File: packages/repograph-browser/src/pipeline/browser-analyze.ts
```typescript
import type { Analyzer, FileContent, CodeGraph, CodeNode, CodeEdge, UnresolvedRelation, LanguageConfig } from 'repograph-core';
import { getLanguageConfigForFile, ParserError, logger, analyzeFileContent, SymbolResolver, createLanguageImportResolvers } from 'repograph-core';
import { createParserForLanguage } from '../tree-sitter/browser-languages';
import { browserPath } from '../utils/path.util';

// This function now uses the full-featured analyzer from repograph-core
async function processFile(
  file: FileContent,
  langConfig: LanguageConfig
): Promise<{ nodes: CodeNode[], relations: UnresolvedRelation[] }> {
  try {
    const parser = await createParserForLanguage(langConfig);
    return analyzeFileContent({ file, langConfig, parser });
  } catch (error) {
    throw new ParserError(`Failed to analyze file ${file.path}`, langConfig.name, error);
  }
}

/**
 * Creates a Tree-sitter based analyzer that runs in the browser's main thread.
 */
export const createBrowserTreeSitterAnalyzer = (): Analyzer => {
  return async (files: readonly FileContent[]): Promise<CodeGraph> => {
    logger.debug(`Starting analysis of ${files.length} files in the browser.`);
    
    const allNodes = new Map<string, CodeNode>();
    let allRelations: UnresolvedRelation[] = [];
    const allFilePaths = files.map(f => f.path);

    for (const file of files) {
      const langConfig = getLanguageConfigForFile(file.path);
      allNodes.set(file.path, {
        id: file.path, type: 'file', name: browserPath.basename(file.path),
        filePath: file.path, startLine: 1, endLine: file.content.split('\n').length,
        language: langConfig?.name,
      });
    }

    const filesToProcess = files.map(file => ({ file, langConfig: getLanguageConfigForFile(file.path) }))
      .filter((item): item is { file: FileContent, langConfig: LanguageConfig } => !!item.langConfig);

    for (const item of filesToProcess) {
      try {
        const result = await processFile(item.file, item.langConfig);
        result.nodes.forEach(node => allNodes.set(node.id, node));
        allRelations.push(...result.relations);
      } catch (error) {
        logger.warn(`Skipping file ${item.file.path} due to analysis error:`, error);
      }
    }
    
    const edges: CodeEdge[] = [];
    const importEdges: CodeEdge[] = [];
    const { getImportResolver } = createLanguageImportResolvers(browserPath);

    // Resolve imports first, as they are needed by the SymbolResolver
    for (const rel of allRelations) {
      if (rel.type === 'imports') {
        const fromNode = allNodes.get(rel.fromId);
        if (!fromNode || fromNode.type !== 'file' || !fromNode.language) continue;

        const resolver = getImportResolver(fromNode.language);
        const toId = resolver(rel.fromId, rel.toName, allFilePaths);
        if (toId && allNodes.has(toId)) {
          importEdges.push({ fromId: rel.fromId, toId, type: 'imports' });
        }
      }
    }

    const symbolResolver = new SymbolResolver(allNodes, importEdges);

    for (const rel of allRelations) {
        if (rel.type === 'imports') continue; // Already handled

        const fromFile = rel.fromId.split('#')[0]!;
        const toNode = symbolResolver.resolve(rel.toName, fromFile);
        if (toNode && rel.fromId !== toNode.id) {
          const edgeType = (rel.type === 'reference' ? 'calls' : rel.type) as CodeEdge['type'];
          edges.push({ fromId: rel.fromId, toId: toNode.id, type: edgeType });
        }
    }
    
    const finalEdges = [...importEdges, ...edges];
    const uniqueEdges = [...new Map(finalEdges.map(e => [`${e.fromId}->${e.toId}->${e.type}`, e])).values()];

    return { nodes: allNodes, edges: uniqueEdges };
  };
};
```

## File: packages/repograph-browser/src/tree-sitter/browser-languages.ts
```typescript
import * as Parser from 'web-tree-sitter';
import type { LanguageConfig, LoadedLanguage } from 'repograph-core';
import { ParserError, logger } from 'repograph-core';

export interface ParserInitializationOptions {
  /**
   * Sets the base URL from which to load Tree-sitter WASM files.
   * For example, if your WASM files are in `public/wasm`, you would set this to `/wasm/`.
   */
  wasmBaseUrl: string;
}

let wasmBaseUrl: string | null = null;
let isInitialized = false;
const loadedLanguages = new Map<string, LoadedLanguage>();

/**
 * Initializes the Tree-sitter parser system.
 * This must be called before any other parser functions.
 * @param options - Must include `wasmBaseUrl`.
 */
export const initializeParser = async (options: ParserInitializationOptions): Promise<void> => {
  if (isInitialized) {
    return;
  }
  if (!options?.wasmBaseUrl) {
    throw new ParserError('`wasmBaseUrl` must be provided during initialization in the browser.');
  }
  wasmBaseUrl = options.wasmBaseUrl;

  // Configure Tree-sitter to locate its main WASM file from the same base URL.
  const baseUrl = wasmBaseUrl.endsWith('/') ? wasmBaseUrl : `${wasmBaseUrl}/`;
  await Parser.Parser.init({
    locateFile(path: string) {
      if (path === 'tree-sitter.wasm') {
        return new URL(path, new URL(baseUrl, window.location.origin)).href;
      }
      return path;
    },
  });
  isInitialized = true;
};

/**
 * Loads a specific language grammar by fetching its WASM file.
 * @param config - The language configuration to load.
 * @returns A LoadedLanguage object containing the config and the initialized parser language.
 */
export const loadLanguage = async (config: LanguageConfig): Promise<LoadedLanguage> => {
  if (loadedLanguages.has(config.name)) {
    return loadedLanguages.get(config.name)!;
  }

  if (!isInitialized || !wasmBaseUrl) {
    throw new ParserError(
      'Parser not initialized. Please call `initializeParser({ wasmBaseUrl: "..." })` before loading any languages.',
      config.name
    );
  }

  try {
    const wasmFileName = config.wasmPath.split('/').pop();
    if (!wasmFileName) {
      throw new ParserError(`Invalid wasmPath for ${config.name}: ${config.wasmPath}`, config.name);
    }

    const baseUrl = wasmBaseUrl.endsWith('/') ? wasmBaseUrl : `${wasmBaseUrl}/`;
    const finalWasmPath = new URL(wasmFileName, new URL(baseUrl, window.location.origin)).href;

    logger.debug(`Fetching Tree-sitter WASM for ${config.name} from: ${finalWasmPath}`);
    const response = await fetch(finalWasmPath);
    if (!response.ok) {
      throw new Error(`Failed to fetch WASM file: ${response.status} ${response.statusText}`);
    }
    const wasmBytes = await response.arrayBuffer();
    const language = await Parser.Language.load(new Uint8Array(wasmBytes));

    const loadedLanguage: LoadedLanguage = { config, language };
    loadedLanguages.set(config.name, loadedLanguage);
    return loadedLanguage;
  } catch (error) {
    const message = `Failed to load Tree-sitter WASM file for ${config.name}. Please ensure WASM files are available at the configured 'wasmBaseUrl'.`;
    logger.error(message, error);
    throw new ParserError(message, config.name, error);
  }
};

/**
 * Creates a Tree-sitter parser instance for a specific language.
 * @param config The language configuration.
 * @returns A parser instance configured for the specified language.
 */
export const createParserForLanguage = async (config: LanguageConfig): Promise<Parser.Parser> => {
  const { language } = await loadLanguage(config);
  const parser = new Parser.Parser();
  parser.setLanguage(language);
  return parser;
};
```

## File: packages/repograph-browser/src/utils/path.util.ts
```typescript
export const browserPath = {
  extname: (filePath: string): string => {
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot === -1) return '';
    const lastSlash = filePath.lastIndexOf('/');
    return lastDot > lastSlash ? filePath.slice(lastDot) : '';
  },
  normalize: (p: string): string => p.replace(/\\/g, '/'),
  basename: (filePath: string): string => {
    const lastSlash = filePath.lastIndexOf('/');
    return filePath.slice(lastSlash + 1);
  },
  dirname: (p: string) => {
    const i = p.lastIndexOf('/');
    return i > -1 ? p.substring(0, i) : '.';
  },
  join: (...args: string[]): string => {
    const path = args.join('/');
    const segments = path.split('/');
    const resolved: string[] = [];
    for (const segment of segments) {
      if (segment === '..') {
        resolved.pop();
      } else if (segment !== '.' && segment !== '') {
        resolved.push(segment);
      }
    }
    return resolved.join('/');
  },
  parse: (p: string) => {
    const ext = browserPath.extname(p);
    const base = browserPath.basename(p);
    const name = base.substring(0, base.length - ext.length);
    const dir = browserPath.dirname(p);
    return { dir, base, name, ext, root: '' };
  },
};
```

## File: packages/repograph-browser/src/browser-high-level.ts
```typescript
import type { FileContent, RankedCodeGraph } from 'repograph-core';
import { logger, createPageRanker, RepoGraphError } from 'repograph-core';
import { createBrowserTreeSitterAnalyzer } from './pipeline/browser-analyze';

export type BrowserRepoGraphOptions = {
  /** An array of file content objects to analyze. This is mandatory in the browser. */
  files: readonly FileContent[];
  /** Logging level. @default 'info' */
  logLevel?: 'silent' | 'error' | 'warn' | 'info' | 'debug';
};

/**
 * A high-level API for generating a code graph in the browser.
 *
 * @param options The configuration object, requires a `files` array.
 * @returns The generated `RankedCodeGraph`.
 */
export const analyzeProject = async (options: BrowserRepoGraphOptions): Promise<RankedCodeGraph> => {
  const { logLevel, files } = options;

  if (logLevel) {
    logger.setLevel(logLevel);
  }

  if (!files || files.length === 0) {
    throw new RepoGraphError('The `files` option with file content is required in the browser environment.');
  }

  try {
    logger.info('1/3 Using provided files...');
    logger.debug(`  -> Found ${files.length} files to analyze.`);

    logger.info('2/3 Analyzing code and building graph...');
    const analyzer = createBrowserTreeSitterAnalyzer();
    const graph = await analyzer(files);
    logger.debug(`  -> Built graph with ${graph.nodes.size} nodes and ${graph.edges.length} edges.`);

    logger.info('3/3 Ranking graph nodes...');
    const ranker = createPageRanker(); // PageRank is browser-compatible
    const rankedGraph = await ranker(graph);
    logger.debug('  -> Ranking complete.');

    return rankedGraph;
  } catch (error) {
    throw new RepoGraphError(`Failed to analyze project in the browser`, error);
  }
};
```

## File: packages/repograph-browser/src/index.ts
```typescript
// High-level API
export { analyzeProject } from './browser-high-level';
export type { BrowserRepoGraphOptions } from './browser-high-level';

// Browser-specific pipeline components
export { createBrowserTreeSitterAnalyzer } from './pipeline/browser-analyze';
export { initializeParser, createParserForLanguage, loadLanguage } from './tree-sitter/browser-languages';
export type { ParserInitializationOptions } from './tree-sitter/browser-languages';

// Core components re-exported from repograph-core
export {
  logger,
  createPageRanker,
  createMarkdownRenderer,
  LANGUAGE_CONFIGS,
  getLanguageConfigForFile,
  getSupportedExtensions,
  RepoGraphError,
  ParserError
} from 'repograph-core';

// Core types re-exported from repograph-core
export type {
  LogLevel,
  LogHandler,
  Logger,
  Analyzer,
  Ranker,
  Renderer,
  FileContent,
  CodeNode,
  CodeNodeType,
  CodeEdge,
  CodeGraph,
  RankedCodeGraph,
  RendererOptions,
  LanguageConfig
} from 'repograph-core';
```

## File: packages/repograph-browser/package.json
```json
{
  "name": "repograph-browser",
  "version": "0.1.10",
  "description": "Browser-specific components for RepoGraph, including a single-threaded Tree-sitter analyzer.",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsup",
    "prepublishOnly": "npm run build",
    "lint": "eslint . --ext .ts",
    "format": "prettier --write \"src/**/*.ts\""
  },
  "dependencies": {
    "repograph-core": "0.1.20",
    "web-tree-sitter": "^0.25.6"
  },
  "devDependencies": {
    "eslint": "^8.57.0",
    "prettier": "^3.2.5",
    "tsup": "^8.0.2",
    "typescript": "^5.4.5"
  },
  "keywords": [
    "codemap",
    "graph",
    "visualization",
    "code-analysis",
    "tree-sitter",
    "repograph",
    "browser"
  ],
  "author": "RelayCoder <you@example.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/relaycoder/repograph.git",
    "directory": "packages/repograph-browser"
  },
  "homepage": "https://github.com/relaycoder/repograph#readme",
  "bugs": {
    "url": "https://github.com/relaycoder/repograph/issues"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

## File: packages/repograph-browser/tsconfig.json
```json
{
  "compilerOptions": {
    // Environment setup & latest features
    "lib": ["ESNext", "DOM"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "allowJs": true,

    // Bundler mode
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true,
    "noEmit": true,

    // Best practices
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,

    // Some stricter flags
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitAny": true,
    "noPropertyAccessFromIndexSignature": true
  },
  "include": [
    "src/**/*"
  ],
  "exclude": [
    "node_modules",
    "dist"
  ]
}
```

## File: packages/repograph-browser/tsup.config.ts
```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm', 'cjs'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  outDir: 'dist',
});
```

## File: packages/repograph-web-demo/scripts/prepare-wasm.cjs
```
const fs = require('fs/promises');
const path = require('path');
const { exec: execCallback } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const exec = promisify(execCallback);

const wasmFilesToCopy = {
  'web-tree-sitter': ['tree-sitter.wasm'],
  'tree-sitter-c': ['tree-sitter-c.wasm'],
  'tree-sitter-c-sharp': ['tree-sitter-c_sharp.wasm'],
  'tree-sitter-cpp': ['tree-sitter-cpp.wasm'],
  'tree-sitter-css': ['tree-sitter-css.wasm'],
  'tree-sitter-go': ['tree-sitter-go.wasm'],
  'tree-sitter-java': ['tree-sitter-java.wasm'],
  'tree-sitter-php': ['tree-sitter-php.wasm'],
  'tree-sitter-python': ['tree-sitter-python.wasm'],
  'tree-sitter-ruby': ['tree-sitter-ruby.wasm'],
  'tree-sitter-rust': ['tree-sitter-rust.wasm'],
  'tree-sitter-solidity': ['tree-sitter-solidity.wasm'],
  // 'tree-sitter-swift': ['tree-sitter-swift.wasm'], // WASM file not available in this package
  'tree-sitter-typescript': [
    'tree-sitter-typescript.wasm',
    'tree-sitter-tsx.wasm'
  ],
  // 'tree-sitter-vue': ['tree-sitter-vue.wasm'], // WASM file not available in this package
};

// We don't want to list web-tree-sitter here because it's a real dependency
// and we'll get its wasm file via require.resolve.
const treeSitterGrammars = {
  "tree-sitter-c": "^0.24.1",
  "tree-sitter-c-sharp": "^0.23.1",
  "tree-sitter-cpp": "^0.23.4",
  "tree-sitter-css": "^0.23.2",
  "tree-sitter-go": "^0.23.4",
  "tree-sitter-java": "^0.23.5",
  "tree-sitter-php": "^0.23.12",
  "tree-sitter-python": "^0.23.6",
  "tree-sitter-ruby": "^0.23.1",
  "tree-sitter-rust": "^0.24.0",
  "tree-sitter-solidity": "^1.2.11",
  "tree-sitter-typescript": "^0.23.2",
};

async function runCommand(command, options) {
  console.log(`> ${command}`);
  try {
    const { stdout, stderr } = await exec(command, options);
    // Many commands log status to stderr, so we show it but don't treat as an error unless exec throws.
    if (stderr) console.log(stderr.trim());
    return stdout.trim();
  } catch (error) {
    console.error(`\n[ERROR] Command failed: ${command}`);
    if (error.stdout) console.error('STDOUT:', error.stdout);
    if (error.stderr) console.error('STDERR:', error.stderr);
    throw error;
  }
}

async function prepareWasm() {
  const publicWasmDir = path.resolve(process.cwd(), 'public/wasm');
  console.log(`Ensuring public/wasm directory exists at: ${publicWasmDir}`);
  await fs.mkdir(publicWasmDir, { recursive: true });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repograph-wasm-'));
  console.log(`Created temporary directory: ${tempDir}`);

  try {
    // --- Step 1: Copy from direct dependencies ---
    console.log('\nCopying WASM from direct dependencies...');
    const webTreeSitterWasm = wasmFilesToCopy['web-tree-sitter'];
    if (webTreeSitterWasm) {
      for (const wasmFileName of webTreeSitterWasm) {
        try {
          const sourcePath = require.resolve(`web-tree-sitter/${wasmFileName}`);
          const destPath = path.join(publicWasmDir, wasmFileName);
          await fs.copyFile(sourcePath, destPath);
          console.log(`Copied ${wasmFileName} from web-tree-sitter to public/wasm/`);
        } catch (error) {
           console.error(`\n[ERROR] Could not copy ${wasmFileName} from web-tree-sitter.`);
           console.error(error.message);
        }
      }
    }

    // --- Step 2: Fetch and extract from temporary grammar packages ---
    console.log('\nFetching and extracting WASM from grammar packages...');
    const grammarPackages = Object.entries(treeSitterGrammars);

    for (const [packageName, version] of grammarPackages) {
      const packageSpec = `${packageName}@${version}`;
      const wasmFileNames = wasmFilesToCopy[packageName];

      if (!wasmFileNames) {
        console.warn(`[WARN] No WASM files configured for ${packageName}, skipping.`);
        continue;
      }
      
      console.log(`\nProcessing ${packageSpec}...`);
      try {
        // `npm pack` downloads a tarball and prints its name to stdout. --silent reduces verbosity.
        const tarballName = await runCommand(`npm pack ${packageSpec} --silent`, { cwd: tempDir });
        const tarballPath = path.join(tempDir, tarballName);
        
        // Extract the tarball. The contents will be in a 'package' directory.
        await runCommand(`tar -xzf "${tarballPath}" -C "${tempDir}"`);

        for (const wasmFileName of wasmFileNames) {
          const sourcePath = path.join(tempDir, 'package', wasmFileName);
          const destPath = path.join(publicWasmDir, wasmFileName);
          await fs.copyFile(sourcePath, destPath);
          console.log(`Copied ${wasmFileName} to public/wasm/`);
        }
      } catch (error) {
        console.error(`\n[ERROR] Failed to process ${packageSpec}.`);
        // Continue to the next package
      }
    }
  } finally {
    // --- Step 3: Cleanup temp dir ---
    console.log(`\nCleaning up temporary directory: ${tempDir}`);
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  // --- Step 4: Clean up dependencies from package.json by direct file modification ---
  console.log('\nChecking for temporary grammar dependencies to remove from package.json...');
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  try {
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);

    const depsToRemove = Object.keys(treeSitterGrammars).filter(
      (pkg) => packageJson.dependencies && packageJson.dependencies[pkg]
    );

    if (depsToRemove.length > 0) {
      console.log(`Found and will remove temporary dependencies: ${depsToRemove.join(', ')}`);
      
      for (const pkg of depsToRemove) {
        delete packageJson.dependencies[pkg];
      }

      const newPackageJsonContent = JSON.stringify(packageJson, null, 2) + '\n';
      await fs.writeFile(packageJsonPath, newPackageJsonContent, 'utf8');
      console.log('✅ package.json has been rewritten. The slow package manager interaction is no longer needed.');
      console.log('The temporary packages will be removed from node_modules on the next `bun install`.');
    } else {
      console.log('No temporary grammar dependencies found in package.json. Nothing to do.');
    }
  } catch (error) {
    console.error(`\n[ERROR] Could not read or modify package.json at ${packageJsonPath}`);
    console.error(error.message);
    // Don't rethrow, as the main goal (copying wasm) was successful.
  }

  console.log('\n✅ WASM file preparation complete.');
}

prepareWasm().catch(err => {
  console.error('\n[FATAL] Failed to prepare WASM files.', err);
  process.exit(1);
});
```

## File: packages/repograph-web-demo/src/components/ui/button.tsx
```typescript
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-blue-600 text-primary-foreground hover:bg-blue-700 text-white",
        destructive:
          "bg-red-500 text-destructive-foreground hover:bg-red-600",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-gray-200 text-secondary-foreground hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
```

## File: packages/repograph-web-demo/src/components/ui/card.tsx
```typescript
import * as React from "react"
import { cn } from "@/lib/utils"

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 shadow-sm", className)}
    {...props}
  />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-4", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"


const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-4 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"


export { Card, CardHeader, CardTitle, CardContent }
```

## File: packages/repograph-web-demo/src/components/ui/textarea.tsx
```typescript
import * as React from "react"

import { cn } from "@/lib/utils"

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          "dark:border-gray-600 dark:bg-gray-900",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
```

## File: packages/repograph-web-demo/src/components/LogViewer.tsx
```typescript
import React from 'react';
import { LogLevel } from 'repograph-browser';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { cn } from '@/lib/utils';

export interface LogEntry {
  level: Exclude<LogLevel, 'silent'>;
  message: string;
  timestamp: number;
}

const levelColorMap: Record<Exclude<LogLevel, 'silent'>, string> = {
  error: 'text-red-500',
  warn: 'text-yellow-500',
  info: 'text-blue-400',
  debug: 'text-gray-500',
};

const LogViewer: React.FC<{ logs: readonly LogEntry[] }> = ({ logs }) => {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle>Logs</CardTitle>
      </CardHeader>
      <CardContent className="flex-grow overflow-auto p-0">
        <div className="p-4 font-mono text-xs">
          {logs.length === 0 && <p className="text-gray-500">No logs yet. Click "Analyze" to start.</p>}
          {logs.map((log, index) => (
            <div key={index} className="flex items-start">
              <span className={cn("font-bold w-12 flex-shrink-0", levelColorMap[log.level])}>
                [{log.level.toUpperCase()}]
              </span>
              <span className="whitespace-pre-wrap break-all">{log.message}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default LogViewer;
```

## File: packages/repograph-web-demo/src/lib/utils.ts
```typescript
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

## File: packages/repograph-web-demo/src/App.tsx
```typescript
import { useState, useEffect, useCallback } from 'react';
import {
  initializeParser,
  logger,
  analyzeProject,
  createMarkdownRenderer,
  FileContent,
  LogHandler,
} from 'repograph-browser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { defaultFilesJSON } from './default-files';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Textarea } from './components/ui/textarea';
import LogViewer, { LogEntry } from './components/LogViewer';
import { Play, Loader } from 'lucide-react';

function App() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [filesInput, setFilesInput] = useState(defaultFilesJSON);
  const [markdownOutput, setMarkdownOutput] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    const init = async () => {
      try {
        await initializeParser({ wasmBaseUrl: '/wasm/' });
        setIsInitialized(true);
        setLogs(prev => [...prev, { level: 'info', message: 'Parser initialized.', timestamp: Date.now() }]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setLogs(prev => [...prev, { level: 'error', message: `Failed to initialize parser: ${message}`, timestamp: Date.now() }]);
      }
    };
    init();
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!isInitialized) {
      setLogs(prev => [...prev, { level: 'warn', message: 'Parser not ready.', timestamp: Date.now() }]);
      return;
    }

    setIsLoading(true);
    setLogs([]);
    setMarkdownOutput('');

    const logHandler: LogHandler = (level, ...args) => {
      const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
      setLogs(prev => [...prev, { level, message, timestamp: Date.now() }]);
    };
    logger.setLogHandler(logHandler);
    logger.setLevel('debug');

    try {
      let files: FileContent[] = [];
      try {
        files = JSON.parse(filesInput);
        if (!Array.isArray(files)) throw new Error("Input is not an array.");
      } catch (error) {
        throw new Error(`Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`);
      }

      const rankedGraph = await analyzeProject({ files });
      const renderer = createMarkdownRenderer();
      const markdown = renderer(rankedGraph);
      setMarkdownOutput(markdown);

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Analysis failed:', message);
    } finally {
      setIsLoading(false);
      logger.setLogHandler(null);
    }
  }, [filesInput, isInitialized]);

  return (
    <div className="min-h-screen flex flex-col p-4 gap-4">
      <header className="flex-shrink-0 flex items-center justify-between">
        <h1 className="text-2xl font-bold">RepoGraph Web Demo</h1>
        <Button onClick={handleAnalyze} disabled={isLoading || !isInitialized}>
          {isLoading ? (
            <Loader className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          Analyze
        </Button>
      </header>
      
      <main className="flex-grow grid grid-cols-1 lg:grid-cols-2 gap-4 h-[calc(100vh-150px)]">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Input Files (JSON)</CardTitle>
          </CardHeader>
          <CardContent className="flex-grow">
            <Textarea
              value={filesInput}
              onChange={(e) => setFilesInput(e.target.value)}
              className="h-full w-full font-mono text-xs"
              placeholder="Paste an array of FileContent objects here..."
            />
          </CardContent>
        </Card>
        
        <Card className="flex flex-col overflow-hidden">
           <CardHeader>
            <CardTitle>Output (Markdown)</CardTitle>
          </CardHeader>
          <CardContent className="flex-grow overflow-auto">
            <ReactMarkdown
              className="prose prose-sm dark:prose-invert max-w-none"
              remarkPlugins={[remarkGfm]}
            >
              {markdownOutput || (isLoading ? "Generating..." : "Output will appear here.")}
            </ReactMarkdown>
          </CardContent>
        </Card>
      </main>

      <footer className="flex-shrink-0 h-[150px]">
        <LogViewer logs={logs} />
      </footer>
    </div>
  );
}

export default App;
```

## File: packages/repograph-web-demo/src/default-files.ts
```typescript
import { FileContent } from "repograph-browser";

const files: FileContent[] = [
  {
    path: "src/main.ts",
    content: `import { formatMessage } from './utils/formatter';
import { createButton } from './ui/button';
import { Greeter } from './services/greeter.py';

console.log('App starting...');

const message = formatMessage('World');
const button = createButton('Click Me');
const greeter = new Greeter();

document.body.innerHTML = \`<h1>\${message}</h1>\`;
document.body.appendChild(button);
console.log(greeter.greet());
`
  },
  {
    path: "src/utils/formatter.ts",
    content: `/**
 * Formats a message with a greeting.
 * @param name The name to include in the message.
 * @returns The formatted message.
 */
export const formatMessage = (name: string): string => {
  return \`Hello, \${name}!\`;
};
`
  },
  {
    path: "src/ui/button.ts",
    content: `import { formatMessage } from '../utils/formatter';

export function createButton(text: string) {
  const btn = document.createElement('button');
  btn.textContent = text;
  // This is a contrived call to create a graph edge
  btn.ariaLabel = formatMessage('Button');
  return btn;
}
`
  },
  {
    path: "src/styles.css",
    content: `body {
  font-family: sans-serif;
  background-color: #f0f0f0;
}

h1 {
  color: #333;
}`
  },
  {
    path: 'src/services/greeter.py',
    content: `class Greeter:
    def __init__(self):
        self.message = "Hello from Python"

    def greet(self):
        return self.message
`
  },
  {
    path: 'src/data/user.java',
    content: `package com.example.data;

public class User {
    private String name;

    public User(String name) {
        this.name = name;
    }

    public String getName() {
        return name;
    }
}
`
  }
];

export const defaultFilesJSON = JSON.stringify(files, null, 2);
```

## File: packages/repograph-web-demo/src/index.css
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* For custom scrollbars */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: #555;
}
```

## File: packages/repograph-web-demo/src/main.tsx
```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

## File: packages/repograph-web-demo/package.json
```json
{
  "name": "repograph-web-demo",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "prepare": "node scripts/prepare-wasm.cjs"
  },
  "dependencies": {
    "@radix-ui/react-slot": "^1.0.2",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "lucide-react": "^0.379.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-markdown": "^9.0.1",
    "remark-gfm": "^4.0.0",
    "repograph-browser": "0.1.10",
    "tailwind-merge": "^2.3.0",
    "web-tree-sitter": "^0.25.6"
  },
  "devDependencies": {
    "@types/node": "^20.12.12",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.19",
    "eslint": "^8.57.0",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.3",
    "typescript": "^5.4.5",
    "vite": "^5.2.12"
  }
}
```

## File: packages/repograph-web-demo/postcss.config.js
```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

## File: packages/repograph-web-demo/tailwind.config.js
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

## File: packages/repograph-web-demo/tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },  "include": ["src"]
}
```

## File: packages/repograph-web-demo/tsconfig.node.json
```json
{
  "compilerOptions": {
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

## File: packages/repograph-web-demo/vite.config.ts
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  optimizeDeps: {
    // Exclude packages that have special loading mechanisms (like wasm)
    // to prevent Vite from pre-bundling them and causing issues.
    exclude: ['web-tree-sitter'],
    // Force pre-bundling of our monorepo packages. As linked dependencies,
    // Vite doesn't optimize it by default. We need to include it so Vite
    // discovers its deep CJS dependencies (like graphology) and converts
    // them to ESM for the dev server. We specifically `exclude` 'web-tree-sitter'
    // above to prevent Vite from interfering with its unique WASM loading mechanism.
    include: ['repograph-core', 'repograph-browser'],
  },
  server: {
    headers: {
      // These headers are required for SharedArrayBuffer, which is used by
      // web-tree-sitter and is good practice for applications using wasm
      // with threading or advanced memory features.
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
    watch: {
      // The wasm files are not directly imported, so Vite doesn't watch them by default.
      // We need to explicitly tell Vite to watch them to trigger a reload on change.
      include: ['public/wasm/**']
    },
    mime: {
      'application/wasm': ['wasm']
    }
  },
})
```

## File: packages/scn-ts-core/src/index.ts
```typescript
import type { RankedCodeGraph } from 'repograph-core';
import { serializeGraph as serialize } from './serializer';

export type SerializeGraphOptions = {
  /**
   * Provides a way to get the content of a source file.
   * This is necessary for features like visibility detection for non-exported
   * symbols or other source-based heuristics.
   * If not provided, such features will be disabled.
   * @param filePath The project-relative path to the file.
   * @returns The string content of the file, or an empty string/undefined if not found.
   */
  getSourceContent?: (filePath: string) => string | undefined;
};

/**
 * Serializes a RankedCodeGraph into the SCN text format.
 * This function is the core rendering layer of `scn-ts` and is environment-agnostic.
 *
 * @param graph - The `RankedCodeGraph` produced by `repograph`.
 * @param options - Additional options, including `getSourceContent` for source analysis.
 * @returns A string containing the full SCN map.
 */
export const serializeGraph = (graph: RankedCodeGraph, options?: SerializeGraphOptions): string => {
  return serialize(graph, options);
};

// Re-export core types for convenience
export * from 'repograph-core';
```

## File: packages/scn-ts-core/src/serializer.ts
```typescript
import type {
  RankedCodeGraph,
  CodeNode,
  CodeEdge as RepographEdge,
  CssIntent,
  CodeNodeType,
} from "repograph-core";
import type { SerializeGraphOptions } from './index';

// Allow for 'contains' and 'references' edges which might be produced by repograph
// but not present in a minimal type definition.
type CodeEdge = Omit<RepographEdge, 'type'> & {
  type: RepographEdge['type'] | 'contains' | 'references';
};

type ScnSymbol = "◇" | "~" | "@" | "{}" | "☰" | "=:" | "⛶" | "¶" | "?";
type QualifierSymbol = "+" | "-" | "..." | "!" | "o";
type CssIntentSymbol = "📐" | "✍" | "💧";

const ENTITY_TYPE_TO_SYMBOL: Record<CodeNodeType, ScnSymbol | undefined> = {
  class: '◇',
  function: '~',
  method: '~',
  interface: '{}',
  enum: '☰',
  type: '=:',
  html_element: '⛶',
  css_rule: '¶',
  namespace: '◇',
  struct: '◇',
  property: '@',
  field: '@',
  variable: '@',
  constant: '@',
  arrow_function: '~',
  constructor: '~',
  file: undefined,
  trait: undefined,
  impl: undefined,
  static: undefined,
  union: undefined,
  template: undefined,
};

const CSS_INTENT_TO_SYMBOL: Record<CssIntent, CssIntentSymbol> = {
  layout: '📐',
  typography: '✍',
  appearance: '💧',
};

type IdManager = {
  getScnId: (repographId: string) => string | undefined;
  isFilePath: (repographId: string) => boolean;
};

const createIdManager = (sortedFileNodes: CodeNode[], nodesByFile: Map<string, CodeNode[]>): IdManager => {
  let fileIdCounter = 1;
  const entityIdCounters = new Map<string, number>(); // file path -> counter
  const repographIdToScnId = new Map<string, string>();
  const fileRepoIdToPath = new Map<string, string>();

  for (const fileNode of sortedFileNodes) {
    const fileId = `${fileIdCounter++}`;
    repographIdToScnId.set(fileNode.id, fileId);
    fileRepoIdToPath.set(fileNode.id, fileNode.filePath);
    entityIdCounters.set(fileNode.filePath, 1);

    const entities = nodesByFile.get(fileNode.filePath) || [];
    entities.sort((a, b) => a.startLine - b.startLine);

    for (const entityNode of entities) {
      const entityCounter = entityIdCounters.get(entityNode.filePath)!;
      const entityId = `${fileId}.${entityCounter}`;
      repographIdToScnId.set(entityNode.id, entityId);
      entityIdCounters.set(entityNode.filePath, entityCounter + 1);
    }
  }
  
  return {
    getScnId: (repographId: string) => repographIdToScnId.get(repographId),
    isFilePath: (repographId: string) => fileRepoIdToPath.has(repographId),
  };
};


const getVisibilitySymbol = (node: CodeNode, getSourceContent?: (path: string) => string | undefined): '+' | '-' | undefined => {
  if (node.visibility === 'public') return '+';
  if (node.visibility === 'private' || node.visibility === 'protected') return '-';
  if (node.type === 'file') return undefined;

  // Fallback to source-based inference if repograph doesn't provide visibility.
  const source = getSourceContent?.(node.filePath);
  if (!source) return undefined;
  
  const line = (source.split('\n')[node.startLine - 1] || '').trim();

  // For class members, default is public unless explicitly private/protected.
  if (['method', 'property', 'field'].includes(node.type)) {
    return (line.startsWith('private') || line.startsWith('protected')) ? '-' : '+';
  }

  // For other top-level entities, check for an `export` keyword in the source.
  const name = node.name.split('.').pop() || node.name;
  const isExported = [
    // `export const MyVar`, `export class MyClass`, `export default function ...`
    `export\\s+(default\\s+)?(async\\s+)?(class|function|interface|enum|type|const|let|var|namespace)\\s+${name}\\b`,
    // `export { MyVar }`
    `export\\s*\\{[^}]*\\b${name}\\b`,
    // `export default` for anonymous functions/arrow functions
    name === 'default' ? `export\\s+default\\s+` : null,
  ].filter(Boolean).some(p => new RegExp(p!).test(source));

  if (isExported) {
    return '+';
  }

  return undefined;
};

const isComponentNode = (node: CodeNode): boolean =>
  (node.type === 'function' || node.type === 'arrow_function') && /^[A-Z]/.test(node.name);

const getNodeSymbol = (node: CodeNode): ScnSymbol => {
  // Heuristic: Treat PascalCase functions as components (e.g., React)
  if (isComponentNode(node)) {
    return '◇';
  }
  // Heuristic: Treat uppercase constants/variables as containers (module pattern)
  if ((node.type === 'variable' || node.type === 'constant') && /^[A-Z]/.test(node.name)) {
    return '◇';
  }
  return ENTITY_TYPE_TO_SYMBOL[node.type] ?? '?';
};

const isPureFunction = (node: CodeNode, getSourceContent?: (path: string) => string | undefined): boolean => {
  if (!['function', 'method', 'arrow_function'].includes(node.type)) return false;
  if (!node.codeSnippet) return false;
  
  const source = getSourceContent?.(node.filePath);
  if (!source) return false;
  
  const lines = source.split('\n');
  const startLine = node.startLine - 1;
  const endLine = node.endLine - 1;
  
  if (startLine < 0 || endLine >= lines.length) return false;
  
  const functionBody = lines.slice(startLine, endLine + 1).join('\n');
  
  const impurePatterns = [
    /console\./, /document\./, /window\./, /localStorage/, /sessionStorage/,
    /fetch\(/, /XMLHttpRequest/, /setTimeout/, /setInterval/, /Math\.random/,
    /Date\(/, /new Date/, /\.push\(/, /\.pop\(/, /\.shift\(/, /\.unshift\(/,
    /\.splice\(/, /\.sort\(/, /\.reverse\(/, /\+\+/, /--/, /\w+\s*=\s*(?!.*return)/,
  ];
  
  if (impurePatterns.some(pattern => pattern.test(functionBody))) {
    return false;
  }
  
  const hasOnlyReturn = /^\s*export\s+(?:async\s+)?function\s+\w+\([^)]*\)(?:\s*:\s*[^{]+)?\s*{\s*return\s+[^;]+;\s*}\s*$/.test(functionBody.replace(/\n/g, ' '));
  
  return hasOnlyReturn;
};


const getQualifiers = (node: CodeNode, getSourceContent?: (path: string) => string | undefined): { access?: '+' | '-'; others: QualifierSymbol[] } => {
  const access = getVisibilitySymbol(node, getSourceContent);
  const others: QualifierSymbol[] = [];
  
  const isAsync = node.isAsync || (node.codeSnippet && /\basync\s+/.test(node.codeSnippet));
  if (isAsync) others.push('...');
  
  const canThrow = node.canThrow || (node.codeSnippet && /\bthrow\b/.test(node.codeSnippet));
  if (canThrow) others.push('!');
  
  const isPure = node.isPure || isPureFunction(node, getSourceContent);
  if (isPure) others.push('o');
  
  return { access, others };
};

const formatCssIntents = (intents: readonly CssIntent[] = []): string => {
  if (intents.length === 0) return '';
  const sortedIntents = [...intents].sort();
  const symbols = sortedIntents.map(intent => CSS_INTENT_TO_SYMBOL[intent] ?? '');
  return `{ ${symbols.join(' ')} }`;
};

const formatFunctionSignature = (snippet: string): string => {
  const paramsMatch = snippet.match(/\(([^)]*)\)/);
  let params = '()';
  if (paramsMatch && paramsMatch[1] !== undefined) {
    const paramContent = paramsMatch[1].replace(/:[^\,)]+/g, ': #');
    params = `(${paramContent})`;
  }

  const returnMatch = snippet.match(/\)\s*:\s*([\w\.<>\[\]\| &]+)/);
  let returnType = '';
  if (returnMatch && returnMatch[1]) {
    const type = returnMatch[1].trim();
    if (type !== 'void' && type !== 'any' && type !== 'unknown') {
       returnType = `: #${type}`;
    }
  }
  return `${params}${returnType}`;
}

const formatJsxAttributes = (snippet: string): string => {
    const attrs = [];
    const idMatch = snippet.match(/id="([^"]+)"/);
    if (idMatch) attrs.push(`id:#${idMatch[1]}`);
    
    const classMatch = snippet.match(/className="([^"]+)"/);
    if (classMatch?.[1]) {
        const classes = classMatch[1].split(' ').map(c => `.${c}`).join(' ');
        attrs.push(`class:${classes}`);
    }
    
    return attrs.length > 0 ? `[ ${attrs.join(' ')} ]` : '';
}

const formatSignature = (node: CodeNode, getSourceContent?: (path: string) => string | undefined): string => {
  if (isComponentNode(node)) {
    const source = getSourceContent?.(node.filePath);
    if (source) {
      const lines = source.split('\n');
      const functionText = lines.slice(node.startLine - 1, Math.min(node.startLine + 9, lines.length)).join('\n');
      
      const patterns = [
        /function\s+\w+\s*\(\s*\{\s*([^}]+)\s*\}\s*:\s*\{[^}]*\}/,
        /\(\s*\{\s*([^}]+)\s*\}\s*:\s*\{[^}]*\}/,
        /\(\s*\{\s*([^}]+)\s*\}[^)]*\)/,
      ];
      
      for (const pattern of patterns) {
        const propMatch = functionText.match(pattern);
        if (propMatch?.[1]) {
          const props = propMatch[1].split(',').map(p => p.trim().split(/[:=]/)[0]?.trim()).filter(Boolean);
          return `{ props: { ${props.map(p => `${p}:#`).join(', ')} } }`;
        }
      }
    }
    return ''; // Component with no destructured props
  }

  if ((node.type === 'function' || node.type === 'method' || node.type === 'constructor' || node.type === 'arrow_function') && node.codeSnippet) {
    return formatFunctionSignature(node.codeSnippet);
  }
  
  if (node.type === 'html_element' && node.codeSnippet) {
    return formatJsxAttributes(node.codeSnippet);
  }

  if (node.type === 'css_rule' && node.cssIntents) {
    return formatCssIntents(node.cssIntents);
  }

  if (node.type === 'type' && node.codeSnippet) {
     const match = node.codeSnippet.match(/=\s*(.+);?/);
     return match?.[1] ? `= ${match[1].trim().replace(/;$/, '')}` : '';
  }

  if ((node.type === 'variable' || node.type === 'constant') && node.codeSnippet) {
    if (/^[A-Z]/.test(node.name)) {
      if (node.codeSnippet.startsWith('{') && node.codeSnippet.endsWith('}')) {
        return node.codeSnippet;
      }
    }
    if (!node.codeSnippet.includes('=')) {
      return `= ${node.codeSnippet}`;
    }
    const match = node.codeSnippet.match(/=\s*(.+)$/);
    if (match && match[1]) {
      return `= ${match[1].trim()}`;
    }
    return node.codeSnippet;
  }
  
  if (['class', 'interface', 'namespace'].includes(node.type)) {
    return '';
  }
  
  return '';
};

const formatNode = (node: CodeNode, graph: RankedCodeGraph, idManager: IdManager, getSourceContent?: (path: string) => string | undefined, level = 0): string => {
  const symbol = getNodeSymbol(node);
  const { access, others } = getQualifiers(node, getSourceContent);
  const signature = formatSignature(node, getSourceContent);
  const scnId = idManager.getScnId(node.id);
  const id = scnId ? `(${scnId})` : '';
  const indent = '  '.repeat(level + 1);

  const parts = [];
  if (access) parts.push(access);
  parts.push(symbol);
  if (id) parts.push(id);

  if (['function', 'method', 'constructor', 'arrow_function'].includes(node.type) && !isComponentNode(node)) {
    const displayName = node.name.includes('.') ? node.name.split('.').pop() || node.name : node.name;
    parts.push(displayName + signature);
  } else {
    const displayName = (['property', 'field', 'html_element'].includes(node.type)) && node.name.includes('.')
      ? node.name.split('.').pop() || node.name
      : node.name;
    parts.push(displayName);
    if (signature) parts.push(signature);
  }

  let mainLine = indent + parts.join(' ');
  if (others.length > 0) {
    const sortedOthers = others.sort((a, b) => ['...', '!', 'o'].indexOf(a) - ['...', '!', 'o'].indexOf(b));
    mainLine += ` ${sortedOthers.join(' ')}`;
  }

  const formatLinks = (prefix: string, edges: readonly CodeEdge[]): string => {
    if (edges.length === 0) return '';
    const links = edges.map((edge: CodeEdge) => {
      const isCallerLink = prefix === '<-';
      const targetRepographId = isCallerLink ? edge.fromId : edge.toId;
      const targetNode = graph.nodes.get(targetRepographId);
      let targetScnId = idManager.getScnId(targetRepographId);

      if (targetNode?.type === 'file') {
        targetScnId = `${targetScnId}.0`;
      }
      return `(${targetScnId})`;
    }).filter(Boolean).sort().join(', ');

    if (!links) return '';
    return `\n${indent}  ${prefix} ${links}`;
  };

  const dependencyEdges = (graph.edges as CodeEdge[]).filter(edge => edge.fromId === node.id && edge.type !== 'contains');
  const callerEdges = (graph.edges as CodeEdge[]).filter(edge => {
    if (edge.toId !== node.id || edge.type === 'contains') return false;
    if (node.type !== 'file' && edge.type === 'imports') return false;
    if (node.type !== 'file') {
      const sourceNode = graph.nodes.get(edge.fromId);
      if (sourceNode?.type === 'file') return false;
    }
    return edge.type !== 'imports';
  });

  return mainLine + formatLinks('->', dependencyEdges) + formatLinks('<-', callerEdges);
};

const serializeFile = (
  fileNode: CodeNode,
  symbols: CodeNode[],
  graph: RankedCodeGraph,
  idManager: IdManager,
  getSourceContent?: (path: string) => string | undefined,
): string => {
  const scnId = idManager.getScnId(fileNode.id) ?? '';

  const formatFileLinks = (prefix: string, edges: readonly CodeEdge[]): string => {
    if (edges.length === 0) return '';
    const links = edges.map((edge: CodeEdge) => {
      const targetId = prefix === '->' ? edge.toId : edge.fromId;
      const targetNode = graph.nodes.get(targetId);
      
      let fileId: string;
      if (targetNode?.type === 'file') {
        fileId = targetId;
      } else {
        const entityFilePath = targetNode?.filePath;
        const fileNode = Array.from(graph.nodes.values()).find(n => n.type === 'file' && n.filePath === entityFilePath);
        fileId = fileNode?.id || targetId;
      }
      
      const targetScnId = idManager.getScnId(fileId);
      return `(${targetScnId}.0)`;
    }).filter(Boolean);
    
    const uniqueLinks = [...new Set(links)].sort().join(', ');
    if (!uniqueLinks) return '';
    return `\n  ${prefix} ${uniqueLinks}`;
  };

  const fileDependencies = graph.edges.filter(e => 
    e.fromId === fileNode.id && 
    (e.type === 'imports' || (e.type === 'calls' && graph.nodes.get(e.toId)?.type !== 'file'))
  );
  
  const fileCallers = graph.edges.filter(e => {
    const toNode = graph.nodes.get(e.toId);
    const fromNode = graph.nodes.get(e.fromId);
    
    return toNode?.filePath === fileNode.filePath && 
           fromNode?.filePath !== fileNode.filePath &&
           ['imports', 'calls'].includes(e.type);
  });

  const formattedPath = fileNode.filePath.includes(' ') ? `"${fileNode.filePath}"` : fileNode.filePath;
  let header = `§ (${scnId}) ${formattedPath}`;
  header += formatFileLinks('->', fileDependencies);
  header += formatFileLinks('<-', fileCallers);

  // Hierarchical rendering
  const nodeWrappers = symbols.map(s => ({ node: s, children: [] as {node: CodeNode, children: any[]}[] })).sort((a,b) => a.node.startLine - b.node.startLine);
  const topLevelSymbols: typeof nodeWrappers = [];

  for (let i = 0; i < nodeWrappers.length; i++) {
    const currentWrapper = nodeWrappers[i];
    if (!currentWrapper) continue;
    let parentWrapper = null;
    
    for (let j = i - 1; j >= 0; j--) {
        const potentialParentWrapper = nodeWrappers[j];
        if (!potentialParentWrapper) continue;
        const isContained = currentWrapper.node.startLine > potentialParentWrapper.node.startLine && 
                           currentWrapper.node.startLine < potentialParentWrapper.node.endLine;
        
        const isJsxNesting = currentWrapper.node.type === 'html_element' && 
                            potentialParentWrapper.node.type === 'html_element' &&
                            currentWrapper.node.startLine === potentialParentWrapper.node.startLine + 1;
        
        if (isContained || isJsxNesting) {
            parentWrapper = potentialParentWrapper;
            break;
        }
    }
    
    if (parentWrapper) {
        parentWrapper.children.push(currentWrapper);
    } else {
        topLevelSymbols.push(currentWrapper);
    }
  }

  const nodeLines: string[] = [];
  const processNode = (wrapper: {node: CodeNode, children: any[]}, level: number) => {
    nodeLines.push(formatNode(wrapper.node, graph, idManager, getSourceContent, level));
    for (const childWrapper of wrapper.children) {
      processNode(childWrapper, level + 1);
    }
  };

  for (const wrapper of topLevelSymbols) {
    processNode(wrapper, 0);
  }

  return [header, ...nodeLines].join('\n');
};

export const serializeGraph = (graph: RankedCodeGraph, options?: SerializeGraphOptions): string => {
  const nodesByFile = new Map<string, CodeNode[]>();
  const fileNodes: CodeNode[] = [];

  for (const node of graph.nodes.values()) {
    if (node.type === 'file') {
      fileNodes.push(node);
      nodesByFile.set(node.filePath, []);
    } else {
      if (!nodesByFile.has(node.filePath)) {
        nodesByFile.set(node.filePath, []); 
      }
      nodesByFile.get(node.filePath)!.push(node);
    }
  }

  const sortedFileNodes = fileNodes.sort((a, b) => a.filePath.localeCompare(b.filePath));
  const idManager = createIdManager(sortedFileNodes, nodesByFile);

  const scnParts = sortedFileNodes.map(fileNode => {
    const symbols = nodesByFile.get(fileNode.filePath) || [];
    symbols.sort((a,b) => a.startLine - b.startLine);
    return serializeFile(fileNode, symbols, graph, idManager, options?.getSourceContent);
  });

  return scnParts.join('\n\n');
};
```

## File: packages/scn-ts-core/package.json
```json
{
  "name": "scn-ts-core",
  "version": "1.0.1",
  "description": "Core SCN serialization logic for Node.js and browser environments.",
  "author": "anton",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/your-username/scn-ts.git",
    "directory": "packages/scn-ts-core"
  },
  "keywords": [
    "scn",
    "context-map",
    "repograph"
  ],
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsup",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "repograph-core": "0.1.20"
  },
  "devDependencies": {
    "@types/node": "^20.11.24",
    "tsup": "^8.0.2",
    "typescript": "^5.3.3"
  }
}
```

## File: packages/scn-ts-core/tsconfig.json
```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "allowJs": true,
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitAny": true,
    "noPropertyAccessFromIndexSignature": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

## File: packages/scn-ts-core/tsup.config.ts
```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'es2020',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  outDir: 'dist',
});
```

## File: packages/scn-ts-browser/src/index.ts
```typescript
import { serializeGraph as coreSerializeGraph } from 'scn-ts-core';
import type { RankedCodeGraph, FileContent, SerializeGraphOptions } from 'scn-ts-core';

/**
 * Creates a function to retrieve file content from an array of FileContent objects.
 * This is useful for providing the `getSourceContent` option to `serializeGraph`.
 * @param files - The array of files from which to look up content.
 * @returns A function that takes a file path and returns its content.
 */
export const createSourceContentGetter = (files: readonly FileContent[]): ((filePath: string) => string | undefined) => {
  const fileMap = new Map(files.map(f => [f.path, f.content]));
  return (filePath: string) => fileMap.get(filePath);
};

/**
 * Generates an SCN context map from a `RankedCodeGraph` in a browser environment.
 *
 * This function orchestrates the process:
 * 1. Takes a `RankedCodeGraph` (presumably generated by `repograph-browser`).
 * 2. Takes the original `FileContent[]` to enable source-based analysis.
 * 3. Serializes the graph into the SCN text format using `scn-ts-core`.
 *
 * @param graph - The `RankedCodeGraph` to serialize.
 * @param files - The original array of `FileContent` used to generate the graph.
 * @param options - Additional options for serialization (rarely needed in browser).
 * @returns The SCN map as a string.
 */
export const generateScn = (
  graph: RankedCodeGraph,
  files: readonly FileContent[],
  options?: Omit<SerializeGraphOptions, 'getSourceContent'>
): string => {
  const getSourceContent = createSourceContentGetter(files);
  return coreSerializeGraph(graph, { ...options, getSourceContent });
};


// Re-export from scn-ts-core for convenience
export { serializeGraph } from 'scn-ts-core';
export type {
  RankedCodeGraph,
  FileContent,
  CodeNode,
  CodeEdge,
  CodeGraph,
  SerializeGraphOptions,
} from 'scn-ts-core';
```

## File: packages/scn-ts-browser/package.json
```json
{
  "name": "scn-ts-browser",
  "version": "1.0.0",
  "description": "Browser-compatible SCN map generator for TypeScript/JavaScript projects.",
  "author": "anton",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/your-username/scn-ts.git",
    "directory": "packages/scn-ts-browser"
  },
  "keywords": [
    "scn",
    "typescript",
    "code-analysis",
    "context-map",
    "repograph",
    "browser"
  ],
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsup",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "scn-ts-core": "1.0.1"
  },
  "peerDependencies": {
    "repograph-browser": ">=0.1.10"
  },
  "devDependencies": {
    "repograph-browser": "0.1.10",
    "tsup": "^8.0.2",
    "typescript": "^5.3.3"
  }
}
```

## File: packages/scn-ts-browser/tsconfig.json
```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "allowJs": true,
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitAny": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

## File: packages/scn-ts-browser/tsup.config.ts
```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  outDir: 'dist',
  external: ['repograph-browser'],
});
```
