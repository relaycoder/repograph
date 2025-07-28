# Directory Structure
```
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
repograph-core/
  src/
    pipeline/
      rank.ts
      render.ts
    tree-sitter/
      language-config.ts
    types/
      graphology-pagerank.d.ts
    utils/
      error.util.ts
      logger.util.ts
    index.ts
    types.ts
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
  index.html
  package.json
  postcss.config.js
  tailwind.config.js
  tsconfig.json
  tsconfig.node.json
  vite.config.ts
```

# Files

## File: repograph-browser/src/pipeline/browser-analyze.ts
````typescript
import type { Analyzer, FileContent, CodeGraph, CodeNode, CodeEdge, UnresolvedRelation, LanguageConfig } from 'repograph-core';
import { getLanguageConfigForFile, ParserError, logger } from 'repograph-core';
import { createParserForLanguage, loadLanguage } from '../tree-sitter/browser-languages';
import { browserPath } from '../utils/path.util';
import { Query } from 'web-tree-sitter';

// Simplified analysis function to run in the main thread
async function processFile(
  file: FileContent,
  langConfig: LanguageConfig
): Promise<{ nodes: CodeNode[], relations: UnresolvedRelation[] }> {
  const nodes: CodeNode[] = [];
  const relations: UnresolvedRelation[] = [];

  try {
    const parser = await createParserForLanguage(langConfig);
    const tree = parser.parse(file.content);

    if (!tree) {
      logger.warn(`Could not parse file: ${file.path}`);
      return { nodes: [], relations: [] };
    }

    const loadedLanguage = await loadLanguage(langConfig);
    const query = new Query(loadedLanguage.language, langConfig.query);
    const captures = query.captures(tree.rootNode);
    
    // NOTE: This is a simplified capture processing logic for demonstration.
    // A full implementation would be much more complex, like the one in `analyzer.worker.ts`
    // from the original project. This version extracts basic definitions and imports.

    // Add file node
    nodes.push({
      id: file.path,
      type: 'file',
      name: browserPath.basename(file.path),
      filePath: file.path,
      startLine: 1,
      endLine: file.content.split('\n').length,
      language: langConfig.name,
    });
    
    for (const { name: captureName, node } of captures) {
      if (captureName.endsWith('.definition')) {
        const type = captureName.split('.')[0] as CodeNode['type'];
        const name = node.childForFieldName('name')?.text || '[anonymous]';
        const nodeId = `${file.path}#${name}`;
        if (!nodes.some(n => n.id === nodeId)) {
          nodes.push({
            id: nodeId,
            type,
            name,
            filePath: file.path,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            codeSnippet: node.text.slice(0, 200),
          });
        }
      } else if (captureName === 'import.source') {
        const importPath = node.text.replace(/['"`]/g, '');
        relations.push({ fromId: file.path, toName: importPath, type: 'imports' });
      }
    }

    return { nodes, relations };
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
      if (langConfig) {
        try {
          const result = await processFile(file, langConfig);
          result.nodes.forEach(node => allNodes.set(node.id, node));
          allRelations.push(...result.relations);
        } catch (error) {
          logger.warn(`Skipping file ${file.path} due to analysis error:`, error);
        }
      }
    }
    
    // Simplified relation resolution
    const edges: CodeEdge[] = [];
    for (const rel of allRelations) {
      if (rel.type === 'imports') {
        // Basic relative path resolution for demo purposes
        const targetPath = browserPath.join(browserPath.dirname(rel.fromId), rel.toName);
        const resolved = allFilePaths.find(p => p.startsWith(targetPath));
        if (resolved) {
          edges.push({ fromId: rel.fromId, toId: resolved, type: 'imports' });
        }
      }
    }

    return { nodes: allNodes, edges };
  };
};
````

## File: repograph-browser/src/tree-sitter/browser-languages.ts
````typescript
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
````

## File: repograph-browser/src/utils/path.util.ts
````typescript
export const browserPath = {
  extname: (filePath: string): string => {
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot === -1) return '';
    const lastSlash = filePath.lastIndexOf('/');
    return lastDot > lastSlash ? filePath.slice(lastDot) : '';
  },
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
};
````

## File: repograph-browser/src/browser-high-level.ts
````typescript
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
````

## File: repograph-browser/src/index.ts
````typescript
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
````

## File: repograph-browser/package.json
````json
{
  "name": "repograph-browser",
  "version": "0.1.6",
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
    "repograph-core": "0.1.4",
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
````

## File: repograph-browser/tsconfig.json
````json
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
````

## File: repograph-browser/tsup.config.ts
````typescript
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
````

## File: repograph-core/src/pipeline/rank.ts
````typescript
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
````

## File: repograph-core/src/pipeline/render.ts
````typescript
import type { Renderer, RankedCodeGraph, RendererOptions, CodeEdge, CodeNode } from '../types';
import { logger } from '../utils/logger.util';

const generateMermaidGraph = (rankedGraph: RankedCodeGraph): string => {
  const fileNodes = [...rankedGraph.nodes.values()].filter(node => node.type === 'file');
  if (fileNodes.length === 0) return '';

  let mermaidString = '```mermaid\n';
  mermaidString += 'graph TD\n';
  
  const edges = new Set<string>();
  for (const edge of rankedGraph.edges) {
      const sourceNode = rankedGraph.nodes.get(edge.fromId);
      const targetNode = rankedGraph.nodes.get(edge.toId);

      if(sourceNode?.type === 'file' && targetNode?.type === 'file' && edge.type === 'imports'){
        const edgeStr = `    ${edge.fromId}["${sourceNode.name}"] --> ${edge.toId}["${targetNode.name}"]`;
        if(!edges.has(edgeStr)) {
            edges.add(edgeStr);
        }
      }
  }

  mermaidString += Array.from(edges).join('\n');
  mermaidString += '\n```\n';
  return mermaidString;
};

const getRank = (id: string, ranks: ReadonlyMap<string, number>): number => ranks.get(id) || 0;

const buildRelationString = (
  label: string,
  edges: readonly CodeEdge[],
  allNodes: ReadonlyMap<string, CodeNode>,
  limit?: number
): string | null => {
  const names = edges.map(e => `\`${allNodes.get(e.toId)?.name ?? 'unknown'}\``);
  if (names.length === 0) return null;
  
  let displayNames = names;
  let suffix = '';
  if (limit && names.length > limit) {
      displayNames = names.slice(0, limit);
      suffix = '...';
  }
  
  return `${label} ${displayNames.join(', ')}${suffix}`;
};

/**
 * Creates the default Markdown renderer. It generates a summary, an optional
 * Mermaid diagram, and a detailed breakdown of files and symbols.
 * @returns A Renderer function.
 */
export const createMarkdownRenderer = (): Renderer => {
  return (rankedGraph: RankedCodeGraph, options: RendererOptions = {}) => { // NOSONAR
    const { nodes, ranks } = rankedGraph;
    const {
      customHeader,
      includeHeader = true,
      includeOverview = true,
      includeMermaidGraph = true,
      includeFileList = true,
      topFileCount = 10,
      includeSymbolDetails = true,
      fileSectionSeparator = '---',
      symbolDetailOptions,
    } = options;
    
    const {
      includeRelations = true,
      includeLineNumber = true,
      includeCodeSnippet = true,
      maxRelationsToShow = 3,
    } = symbolDetailOptions || {};

    const fileNodes = [...nodes.values()].filter(attrs => attrs.type === 'file');
    const sortedFiles = fileNodes
      .sort((a, b) => getRank(b.id, ranks) - getRank(a.id, ranks));
    
    // Debug logging
    logger.debug(`Total nodes: ${nodes.size}, File nodes: ${fileNodes.length}, Node types:`, 
      [...nodes.values()].map(n => n.type).reduce((acc, type) => {
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>));

    let md = '';
    if (customHeader) {
      md += `${customHeader}\n\n`;
    } else if (includeHeader) {
      md += `# RepoGraph\n\n`;
      md += `_Generated by RepoGraph on ${new Date().toISOString()}_\n\n`;
    }

    if (includeOverview) {
      md += `## 🚀 Project Overview\n\n`;
      md += `This repository contains ${nodes.size} nodes (${sortedFiles.length} files).\n\n`;
    }

    if (includeMermaidGraph) {
      md += `### Module Dependency Graph\n\n`;
      md += generateMermaidGraph(rankedGraph);
    }
    
    if (includeFileList && sortedFiles.length > 0) {
      md += `### Top ${topFileCount} Most Important Files\n\n`;
      md += `| Rank | File | Description |\n`;
      md += `| :--- | :--- | :--- |\n`;
      sortedFiles.slice(0, topFileCount).forEach((file, i) => {
        md += `| ${i + 1} | \`${file.filePath}\` | Key module in the architecture. |\n`;
      });
      md += `\n${fileSectionSeparator}\n\n`;
    }

    if (includeSymbolDetails) {
      md += `## 📂 File & Symbol Breakdown\n\n`;
      for (const fileNode of sortedFiles) {
        md += `### [\`${fileNode.filePath}\`](./${fileNode.filePath})\n\n`;
        
        const symbolNodes = [...nodes.values()]
          .filter(node => node.filePath === fileNode.filePath && node.type !== 'file')
          .sort((a, b) => a.startLine - b.startLine);

        if (symbolNodes.length > 0) {
          for (const symbol of symbolNodes) {
            const detailParts: string[] = [];
            if (includeRelations) {
              const outgoingEdges = rankedGraph.edges.filter(e => e.fromId === symbol.id);
              if (outgoingEdges.length > 0) {
                const edgeGroups = outgoingEdges.reduce((acc, edge) => {
                  (acc[edge.type] = acc[edge.type] || []).push(edge);
                  return acc;
                }, {} as Record<CodeEdge['type'], CodeEdge[]>);
                
                const relationParts = [
                  buildRelationString('inherits', edgeGroups.inherits || [], nodes),
                  buildRelationString('implements', edgeGroups.implements || [], nodes),
                  buildRelationString('calls', edgeGroups.calls || [], nodes, maxRelationsToShow),
                ].filter((s): s is string => s !== null);
                if (relationParts.length > 0) detailParts.push(`(${relationParts.join('; ')})`);
              }
            }
            if (includeLineNumber) {
              detailParts.push(`- _L${symbol.startLine}_`);
            }

            md += `- **\`${symbol.type} ${symbol.name}\`**${detailParts.length > 0 ? ` ${detailParts.join(' ')}` : ''}\n`;
            
            if (includeCodeSnippet && symbol.codeSnippet) {
              // Use language from file extension for syntax highlighting if possible
              const lang = fileNode.language || fileNode.filePath.split('.').pop() || '';
              md += `  \`\`\`${lang}\n  ${symbol.codeSnippet}\n  \`\`\`\n`;
            }
          }
        } else {
            md += `_No symbols identified in this file._\n`
        }
        md += `\n${fileSectionSeparator}\n\n`;
      }
    }

    return md;
  };
};
````

## File: repograph-core/src/tree-sitter/language-config.ts
````typescript
import type { Language } from 'web-tree-sitter';

export interface LanguageConfig {
  name: string;
  extensions: string[];
  wasmPath: string;
  query: string;
}

export interface LoadedLanguage {
  config: LanguageConfig;
  language: Language;
}

const TS_BASE_QUERY = `
(import_statement
  source: (string) @import.source) @import.statement

(class_declaration) @class.definition
(export_statement declaration: (class_declaration)) @class.definition

(function_declaration
  ("async")? @qualifier.async
  parameters: (formal_parameters) @symbol.parameters
  return_type: (type_annotation)? @symbol.returnType
) @function.definition
(export_statement
  declaration: (function_declaration
    ("async")? @qualifier.async
    parameters: (formal_parameters) @symbol.parameters
    return_type: (type_annotation)? @symbol.returnType
  )
) @function.definition

(variable_declarator
  value: (arrow_function
    ("async")? @qualifier.async
    parameters: (formal_parameters)? @symbol.parameters
    return_type: (type_annotation)? @symbol.returnType
  )
) @function.arrow.definition
(public_field_definition
  value: (arrow_function
    ("async")? @qualifier.async
    parameters: (formal_parameters)? @symbol.parameters
    return_type: (type_annotation)? @symbol.returnType
  )
) @function.arrow.definition
(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      value: (arrow_function
        ("async")? @qualifier.async
        parameters: (formal_parameters)? @symbol.parameters
        return_type: (type_annotation)? @symbol.returnType
      )
    )
  )
) @function.arrow.definition

; Export default arrow function: export default () => {}
(export_statement
  value: (arrow_function
    ("async")? @qualifier.async
    parameters: (formal_parameters)? @symbol.parameters
    return_type: (type_annotation)? @symbol.returnType
  )
) @function.arrow.definition

; Alternative pattern for export default arrow function
(export_statement
  (arrow_function
    ("async")? @qualifier.async
    parameters: (formal_parameters)? @symbol.parameters
    return_type: (type_annotation)? @symbol.returnType
  )
) @function.arrow.definition

; Export star statements: export * from './module'
(export_statement
  source: (string) @import.source
) @import.statement

(interface_declaration) @interface.definition
(export_statement declaration: (interface_declaration)) @interface.definition

(type_alias_declaration) @type.definition
(export_statement declaration: (type_alias_declaration)) @type.definition

(enum_declaration) @enum.definition
(export_statement declaration: (enum_declaration)) @enum.definition

(internal_module) @namespace.definition
(export_statement declaration: (internal_module)) @namespace.definition
(ambient_declaration (module) @namespace.definition)

(method_definition
  (accessibility_modifier)? @qualifier.visibility
  ("static")? @qualifier.static
  ("async")? @qualifier.async
  parameters: (formal_parameters) @symbol.parameters
  return_type: (type_annotation)? @symbol.returnType
) @method.definition

(public_field_definition
  (accessibility_modifier)? @qualifier.visibility
  ("static")? @qualifier.static
  type: (type_annotation)? @symbol.returnType
) @field.definition

(variable_declarator) @variable.definition
(export_statement declaration: (lexical_declaration (variable_declarator))) @variable.definition

(call_expression
  function: (identifier) @function.call)

(call_expression
  function: (member_expression
    property: (property_identifier) @function.call))

(identifier) @identifier.reference

(throw_statement) @qualifier.throws

; Class inheritance and implementation patterns
(extends_clause (identifier) @class.inheritance)
(implements_clause (type_identifier) @class.implementation)
`;

const TSX_SPECIFIC_QUERY = `
; JSX/TSX specific
(jsx_opening_element
  name: (_) @html.tag
) @html.element.definition

; className="..."
(jsx_attribute
  (property_identifier) @_p
  (string) @css.class.reference
  (#eq? @_p "className"))

; id="..."
(jsx_attribute
  (property_identifier) @_p
  (string) @css.id.reference
  (#eq? @_p "id"))
`;

export const LANGUAGE_CONFIGS: LanguageConfig[] = [
  {
    name: 'typescript',
    extensions: ['.ts', '.js', '.mjs', '.cjs'],
    wasmPath: 'tree-sitter-typescript.wasm',
    query: TS_BASE_QUERY
  },
  {
    name: 'tsx',
    extensions: ['.tsx', '.jsx'],
    wasmPath: 'tree-sitter-tsx.wasm',
    query: `${TS_BASE_QUERY}\n${TSX_SPECIFIC_QUERY}`
  },
  {
    name: 'python',
    extensions: ['.py', '.pyw'],
    wasmPath: 'tree-sitter-python.wasm',
    query: `
(import_statement) @import.statement
(import_from_statement
  module_name: (relative_import) @import.source) @import.statement
(import_from_statement
  module_name: (dotted_name) @import.source) @import.statement

(class_definition) @class.definition

(function_definition) @function.definition

(decorated_definition
  (function_definition)) @function.definition

(decorated_definition
  (class_definition)) @class.definition

(class_definition
  body: (block (function_definition) @method.definition))

(expression_statement
  (assignment)) @variable.definition

(raise_statement) @qualifier.throws

; Python inheritance patterns
(class_definition
  superclasses: (argument_list (identifier) @class.inheritance))
`
  },
  {
    name: 'java',
    extensions: ['.java'],
    wasmPath: 'tree-sitter-java.wasm',
    query: `
(import_declaration
  (scoped_identifier) @import.source) @import.statement

(class_declaration) @class.definition
(interface_declaration) @interface.definition
(enum_declaration) @enum.definition

(method_declaration
  (modifiers)? @qualifier.modifiers
) @method.definition

(constructor_declaration) @constructor.definition

(field_declaration) @field.definition

(throw_statement) @qualifier.throws

; Java inheritance and implementation patterns
(superclass (type_identifier) @class.inheritance)
(super_interfaces (type_list (type_identifier) @class.implementation))

`
  },
  {
    name: 'cpp',
    extensions: ['.cpp', '.cc', '.cxx', '.h', '.hpp', '.hh', '.hxx'],
    wasmPath: 'tree-sitter-cpp.wasm',
    query: `
(preproc_include) @import.statement

(function_definition) @function.definition
(declaration
  declarator: (function_declarator)) @function.declaration

(class_specifier) @class.definition
(struct_specifier) @struct.definition
(union_specifier) @union.definition
(enum_specifier) @enum.definition

(namespace_definition) @namespace.definition

(template_declaration) @template.definition

(function_definition declarator: (qualified_identifier)) @method.definition
(field_declaration declarator: (function_declarator)) @method.definition
(field_declaration) @field.definition

(throw_expression) @qualifier.throws
`
  },
  {
    name: 'c',
    extensions: ['.c'],
    wasmPath: 'tree-sitter-c.wasm',
    query: `
(preproc_include) @import.statement

(function_definition) @function.definition
(declaration declarator: (function_declarator)) @function.declaration
(struct_specifier) @struct.definition
(union_specifier) @union.definition
(enum_specifier) @enum.definition
(type_definition) @type.definition
`
  },
  {
    name: 'go',
    extensions: ['.go'],
    wasmPath: 'tree-sitter-go.wasm',
    query: `
(import_declaration) @import.statement

(function_declaration) @function.definition
(method_declaration) @method.definition

(type_declaration) @type.definition

(var_declaration) @variable.definition
(const_declaration) @constant.definition
`
  },
  {
    name: 'rust',
    extensions: ['.rs'],
    wasmPath: 'tree-sitter-rust.wasm',
    query: `
(mod_item
  name: (identifier) @import.source) @import.statement

(function_item) @function.definition
(impl_item) @impl.definition

(struct_item) @struct.definition
(enum_item) @enum.definition
(trait_item) @trait.definition
(function_signature_item) @method.definition

(type_item) @type.definition
(const_item) @constant.definition
(static_item) @static.definition

(function_signature_item) @function.declaration
`
  },
  {
    name: 'csharp',
    extensions: ['.cs'],
    wasmPath: 'tree-sitter-c_sharp.wasm',
    query: `
(using_directive) @import.statement

(class_declaration) @class.definition
(interface_declaration) @interface.definition
(struct_declaration) @struct.definition
(enum_declaration) @enum.definition

(method_declaration) @method.definition
(constructor_declaration) @constructor.definition

(field_declaration) @field.definition
(property_declaration) @property.definition

(namespace_declaration) @namespace.definition

(throw_statement) @qualifier.throws
`
  },
  {
    name: 'php',
    extensions: ['.php'],
    wasmPath: 'tree-sitter-php.wasm',
    query: `
      (namespace_definition) @namespace.definition
      (class_declaration) @class.definition
      (function_definition) @function.definition
      (method_declaration) @method.definition
    `
  },
  {
    name: 'ruby',
    extensions: ['.rb'],
    wasmPath: 'tree-sitter-ruby.wasm',
    query: `
      (module) @module.definition
      (class) @class.definition
      (method) @method.definition
      (singleton_method) @method.definition
    `
  },
  {
    name: 'solidity',
    extensions: ['.sol'],
    wasmPath: 'tree-sitter-solidity.wasm',
    query: `
      (contract_declaration) @class.definition
      (function_definition) @function.definition
      (event_definition) @enum.definition
    `
  },
  // {
  //   name: 'swift',
  //   extensions: ['.swift'],
  //   wasmPath: 'tree-sitter-swift.wasm',
  //   query: `
  //     (class_declaration) @class.definition
  //     (protocol_declaration) @trait.definition
  //     (function_declaration) @function.definition
  //     (protocol_function_declaration) @function.definition
  //     (property_declaration) @field.definition
  //   `
  // },
  // {
  //   name: 'vue',
  //   extensions: ['.vue'],
  //   wasmPath: 'tree-sitter-vue.wasm',
  //   query: `
  //     (script_element .
  //       [
  //         (lexical_declaration (variable_declarator)) @variable.definition
  //         (function_declaration) @function.definition
  //       ])
  //
  //     (element
  //       (start_tag
  //         (tag_name) @html.tag
  //       )
  //     ) @html.element.definition
  // `
  // },
  {
    name: 'css',
    extensions: ['.css'],
    wasmPath: 'tree-sitter-css.wasm',
    query: `
      (rule_set) @css.rule.definition
    `
  }
];

/**
 * Get the language configuration for a given file extension
 */
export function getLanguageConfigForFile(filePath: string): LanguageConfig | null {
  const extension = filePath.substring(filePath.lastIndexOf('.'));
  
  for (const config of LANGUAGE_CONFIGS) {
    if (config.extensions.includes(extension)) {
      return config;
    }
  }
  
  return null;
}

/**
 * Get all supported file extensions
 */
export function getSupportedExtensions(): string[] {
  return LANGUAGE_CONFIGS.flatMap(config => config.extensions);
}
````

## File: repograph-core/src/types/graphology-pagerank.d.ts
````typescript
declare module 'graphology-pagerank' {
  import type Graph from 'graphology';

  export default function pagerank<T = any>(graph: Graph<T>, options?: {
    alpha?: number;
    tolerance?: number;
    maxIterations?: number;
    getEdgeWeight?: (edge: string) => number;
  }): Record<string, number>;
}
````

## File: repograph-core/src/utils/error.util.ts
````typescript
export class RepoGraphError extends Error {
  constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = 'RepoGraphError';
    if (this.originalError instanceof Error && this.originalError.stack) {
      this.stack = `${this.stack}\nCaused by: ${this.originalError.stack}`;
    }
  }
}

export class FileSystemError extends RepoGraphError {
  constructor(message: string, public readonly path: string, originalError?: unknown) {
    super(`${message}: ${path}`, originalError);
    this.name = 'FileSystemError';
  }
}

export class ParserError extends RepoGraphError {
  constructor(message: string, public readonly language?: string, originalError?: unknown) {
    super(language ? `[${language}] ${message}` : message, originalError);
    this.name = 'ParserError';
  }
}
````

## File: repograph-core/src/utils/logger.util.ts
````typescript
export const LogLevels = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
} as const;

export type LogLevel = keyof typeof LogLevels;

export type LogHandler = (level: Exclude<LogLevel, 'silent'>, ...args: any[]) => void;

let customHandler: LogHandler | null = null;

// This state is internal to the logger module.
let currentLevel: LogLevel = 'silent';

const logFunctions: Record<Exclude<LogLevel, 'silent'>, (...args: any[]) => void> = {
  error: console.error,
  warn: console.warn,
  info: console.log, // Use console.log for info for cleaner output
  debug: console.debug,
};

const log = (level: LogLevel, ...args: any[]): void => {
  if (level === 'silent' || LogLevels[level] > LogLevels[currentLevel]) {
    return;
  }

  if (customHandler) {
    customHandler(level, ...args);
  } else {
    logFunctions[level](...args);
  }
};

export type Logger = {
  readonly error: (...args: any[]) => void;
  readonly warn: (...args: any[]) => void;
  readonly info: (...args: any[]) => void;
  readonly debug: (...args: any[]) => void;
  readonly setLevel: (level: LogLevel) => void;
  readonly getLevel: () => LogLevel;
  readonly setLogHandler: (handler: LogHandler | null) => void;
};

const createLogger = (): Logger => {
  return Object.freeze({
    error: (...args: any[]) => log('error', ...args),
    warn: (...args: any[]) => log('warn', ...args),
    info: (...args: any[]) => log('info', ...args),
    debug: (...args: any[]) => log('debug', ...args),
    setLevel: (level: LogLevel) => {
      if (level in LogLevels) {
        currentLevel = level;
      }
    },
    getLevel: () => currentLevel,
    setLogHandler: (handler: LogHandler | null) => {
      customHandler = handler;
    },
  });
};

export const logger = createLogger();
````

## File: repograph-core/src/index.ts
````typescript
// Core types
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
  CssIntent,
  Ranker,
  Renderer,
  RendererOptions,
  UnresolvedRelation,
} from './types';

// Core pipeline component factories
export { createPageRanker } from './pipeline/rank';
export { createMarkdownRenderer } from './pipeline/render';

// Core utilities
export { logger } from './utils/logger.util';
export type { LogLevel, Logger, LogHandler } from './utils/logger.util';
export { RepoGraphError, FileSystemError, ParserError } from './utils/error.util';

// Language configurations
export {
  LANGUAGE_CONFIGS,
  getLanguageConfigForFile,
  getSupportedExtensions,
} from './tree-sitter/language-config';
export type { LanguageConfig, LoadedLanguage } from './tree-sitter/language-config';
````

## File: repograph-core/src/types.ts
````typescript
// Core Data Structures

/** Represents a single file read from disk. Immutable. */
export type FileContent = {
  readonly path: string;
  readonly content: string;
};

/** The type of a symbol identified in the code. */
export type CodeNodeType =
  | 'file'
  | 'class'
  | 'function'
  | 'interface'
  | 'variable'
  | 'type'
  | 'arrow_function'
  | 'method'
  | 'field'
  | 'struct'
  | 'enum'
  | 'namespace'
  | 'trait'
  | 'impl'
  | 'constructor'
  | 'property'
  | 'constant'
  | 'static'
  | 'union'
  | 'template'
  | 'html_element'
  | 'css_rule';

/** For CSS nodes, a semantic grouping of its properties. */
export type CssIntent = 'layout' | 'typography' | 'appearance';

/** New type for access modifiers. */
export type CodeNodeVisibility = 'public' | 'private' | 'protected' | 'internal' | 'default';

/** Represents a single, identifiable symbol (or a file) in the code. Immutable. */
export type CodeNode = {
  readonly id: string; // Unique identifier (e.g., 'src/api.ts#MyClass')
  readonly type: CodeNodeType;
  readonly name: string; // e.g., 'MyClass'
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly language?: string; // For file nodes, the detected language
  readonly codeSnippet?: string; // e.g., function signature

  // --- NEW FIELDS from scn-ts report ---
  /** The access modifier of the symbol (e.g., public, private). Maps to SCN '+' or '-'. */
  readonly visibility?: CodeNodeVisibility;
  /** Whether the symbol (e.g., a function or method) is asynchronous. Maps to SCN '...'. */
  readonly isAsync?: boolean;
  /** Whether the symbol is a static member of a class/struct. */
  readonly isStatic?: boolean;
  /** The return type of a function/method, as a string. Maps to SCN '#(type)'. */
  readonly returnType?: string;
  /** An array of parameters for functions/methods. */
  readonly parameters?: { name: string; type?: string }[];
  /** Whether a function is known to throw exceptions. Maps to SCN '!' */
  readonly canThrow?: boolean; // Populated by analyzer
  /** Whether a function is believed to be pure. Maps to SCN 'o' */
  readonly isPure?: boolean; // Not implemented yet
  /** For UI nodes, the HTML tag name (e.g., 'div'). */
  readonly htmlTag?: string;
  /** For UI nodes, a map of attributes. */
  readonly attributes?: ReadonlyMap<string, string>; // Not used yet
  /** For CSS nodes, the full selector. */
  readonly cssSelector?: string;
  /** For CSS rules, a list of semantic intents. */
  readonly cssIntents?: readonly CssIntent[];
};

/** Represents a directed relationship between two CodeNodes. Immutable. */
export type CodeEdge = {
  readonly fromId: string; // ID of the source CodeNode
  readonly toId: string;   // ID of the target CodeNode
  readonly type: 'imports' | 'calls' | 'inherits' | 'implements';
};

/** Represents a potential relationship discovered in a file, to be resolved later. */
export type UnresolvedRelation = {
  readonly fromId: string;
  readonly toName: string;
  readonly type: 'imports' | 'calls' | 'inherits' | 'implements' | 'reference';
};

/** The complete, raw model of the repository's structure. Immutable. */
export type CodeGraph = {
  readonly nodes: ReadonlyMap<string, CodeNode>;
  readonly edges: readonly CodeEdge[];
};

/** A CodeGraph with an added 'rank' score for each node. Immutable. */
export type RankedCodeGraph = CodeGraph & {
  readonly ranks: ReadonlyMap<string, number>; // Key is CodeNode ID
};

/** The output of a map generation process, containing the graph and rendered output. */
export type RepoGraphMap = {
  readonly graph: RankedCodeGraph;
  readonly markdown: string;
};

// High-Level API Options

/** Configuration for the final Markdown output. */
export type RendererOptions = {
  /** Custom text to appear at the top of the Markdown file. Overrides `includeHeader`. */
  readonly customHeader?: string;
  /** Include the default `RepoGraph` header. @default true */
  readonly includeHeader?: boolean;
  /** Include the project overview section. @default true */
  readonly includeOverview?: boolean;
  /** Include a Mermaid.js dependency graph. @default true */
  readonly includeMermaidGraph?: boolean;
  /** Include the list of top-ranked files. @default true */
  readonly includeFileList?: boolean;
  /** Number of files to show in the top list. @default 10 */
  readonly topFileCount?: number;
  /** Include detailed breakdowns for each symbol. @default true */
  readonly includeSymbolDetails?: boolean;
  /** String to use as a separator between file sections. @default '---' */
  readonly fileSectionSeparator?: string;

  /** Options for how individual symbols are rendered */
  readonly symbolDetailOptions?: {
    /** Include relationships (calls, inherits, etc.) in the symbol line. @default true */
    readonly includeRelations?: boolean;
    /** Include the starting line number. @default true */
    readonly includeLineNumber?: boolean;
    /** Include the code snippet for the symbol. @default true */
    readonly includeCodeSnippet?: boolean;
    /** Max number of relations to show per type (e.g., 'calls'). @default 3 */
    readonly maxRelationsToShow?: number;
  };
};

// Low-Level Functional Pipeline Contracts

/** Analyzes file content and builds the dependency graph. */
export type Analyzer = (files: readonly FileContent[]) => Promise<CodeGraph>;

/** Ranks the nodes in a graph. */
export type Ranker = (graph: CodeGraph) => Promise<RankedCodeGraph>;

/** Renders a ranked graph into a string format. */
export type Renderer = (rankedGraph: RankedCodeGraph, options?: RendererOptions) => string;
````

## File: repograph-core/package.json
````json
{
  "name": "repograph-core",
  "version": "0.1.4",
  "description": "Core types, interfaces, and environment-agnostic utilities for RepoGraph.",
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
    "graphology": "^0.26.0",
    "graphology-pagerank": "^1.1.0",
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
    "repograph"
  ],
  "author": "RelayCoder <you@example.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/relaycoder/repograph.git",
    "directory": "packages/repograph-core"
  },
  "homepage": "https://github.com/relaycoder/repograph#readme",
  "bugs": {
    "url": "https://github.com/relaycoder/repograph/issues"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
````

## File: repograph-core/tsconfig.json
````json
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
````

## File: repograph-core/tsup.config.ts
````typescript
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
````

## File: repograph-web-demo/scripts/prepare-wasm.cjs
````
const fs = require('fs/promises');
const path = require('path');

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

async function prepareWasm() {
  const publicWasmDir = path.resolve(process.cwd(), 'public/wasm');
  console.log(`Ensuring public/wasm directory exists at: ${publicWasmDir}`);
  await fs.mkdir(publicWasmDir, { recursive: true });

  console.log('Starting to copy WASM files...');
  for (const [packageName, wasmFileNames] of Object.entries(wasmFilesToCopy)) {
    for (const wasmFileName of wasmFileNames) {
      try {
        // Find the package's directory by resolving its package.json
        const packageJsonPath = require.resolve(`${packageName}/package.json`);
        const packageDir = path.dirname(packageJsonPath);
        const sourcePath = path.join(packageDir, wasmFileName);

        const destPath = path.join(publicWasmDir, wasmFileName);
        
        await fs.copyFile(sourcePath, destPath);
        console.log(`Copied ${wasmFileName} to public/wasm/`);
      } catch (error) {
        console.error(`\n[ERROR] Could not copy ${wasmFileName} from ${packageName}.`);
        if (error.code === 'ENOENT') {
          console.error(`File not found at source. This likely means the package didn't install correctly or the WASM file is missing from it.`);
        } else {
          console.error('An unexpected error occurred:', error.message);
        }
        // We will not rethrow, to let other files try to copy.
      }
    }
  }
  console.log('WASM file preparation complete.');
}

prepareWasm().catch(err => {
  console.error('\n[FATAL] Failed to prepare WASM files.', err);
  process.exit(1);
});
````

## File: repograph-web-demo/src/components/ui/button.tsx
````typescript
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
````

## File: repograph-web-demo/src/components/ui/card.tsx
````typescript
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
````

## File: repograph-web-demo/src/components/ui/textarea.tsx
````typescript
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
````

## File: repograph-web-demo/src/components/LogViewer.tsx
````typescript
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
````

## File: repograph-web-demo/src/lib/utils.ts
````typescript
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
````

## File: repograph-web-demo/src/App.tsx
````typescript
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
````

## File: repograph-web-demo/src/default-files.ts
````typescript
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
````

## File: repograph-web-demo/src/index.css
````css
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
````

## File: repograph-web-demo/src/main.tsx
````typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
````

## File: repograph-web-demo/index.html
````html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>RepoGraph Web Demo</title>
  </head>
  <body class="bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
````

## File: repograph-web-demo/package.json
````json
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
    "repograph-browser": "0.1.6",
    "tailwind-merge": "^2.3.0",
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
````

## File: repograph-web-demo/postcss.config.js
````javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
````

## File: repograph-web-demo/tailwind.config.js
````javascript
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
````

## File: repograph-web-demo/tsconfig.json
````json
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
````

## File: repograph-web-demo/tsconfig.node.json
````json
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
````

## File: repograph-web-demo/vite.config.ts
````typescript
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
    // Force pre-bundling of repograph-core. As a linked monorepo package,
    // Vite doesn't optimize it by default. We need to include it so Vite
    // discovers its deep CJS dependencies (like graphology) and converts
    // them to ESM for the dev server. We avoid including 'repograph-browser'
    // directly, as that seems to interfere with web-tree-sitter's WASM loading.
    include: ['repograph-core'],
  },
  server: {
    headers: {
      // These headers are required for SharedArrayBuffer, which is used by
      // web-tree-sitter and is good practice for applications using wasm
      // with threading or advanced memory features.
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    }
  }
})
````
