# 7378 Directory Structure
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
  repograph-core/
    src/
      pipeline/
        analysis-logic.ts
        rank.ts
        relation-resolver.ts
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
  scn-ts/
    src/
      cli.ts
      index.ts
      serializer.ts
    test/
      ts/
        e2e/
          cli.test.ts
          config-file.test.ts
          filesystem.test.ts
        integration/
          css-parsing.test.ts
          dependency-graph.test.ts
          programmatic-api.test.ts
        unit/
          code-entities.test.ts
          general-structural.test.ts
          jsx.test.ts
          qualifiers.test.ts
          type-system.test.ts
      test.util.ts
    package.json
    tsconfig.json
    tsup.config.ts
src/
  pipeline/
    analyze.ts
    analyzer.worker.ts
    discover.ts
    rank.ts
  tree-sitter/
    languages.ts
  utils/
    fs.util.ts
  composer.ts
  high-level.ts
  index.ts
package.json
tsconfig.json
tsup.config.ts
```

# Files

## File: packages/repograph-browser/src/pipeline/browser-analyze.ts
````typescript
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
````

## File: packages/repograph-browser/src/tree-sitter/browser-languages.ts
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

## File: packages/repograph-browser/src/utils/path.util.ts
````typescript
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
````

## File: packages/repograph-browser/src/browser-high-level.ts
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

## File: packages/repograph-browser/src/index.ts
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

## File: packages/repograph-browser/package.json
````json
{
  "name": "repograph-browser",
  "version": "0.1.9",
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
    "repograph-core": "0.1.19",
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

## File: packages/repograph-browser/tsconfig.json
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

## File: packages/repograph-browser/tsup.config.ts
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

## File: packages/repograph-core/src/pipeline/analysis-logic.ts
````typescript
import type { Parser as TSParser, Node as TSNode, QueryCapture as TSMatch } from 'web-tree-sitter';
import { Query } from 'web-tree-sitter';
import type { CodeNode, CodeNodeType, CodeNodeVisibility, FileContent, UnresolvedRelation } from '../types';
import type { LanguageConfig } from '../tree-sitter/language-config';

// --- UTILITY FUNCTIONS (mirrored from original analyze.ts) ---

const getNodeText = (node: TSNode, content: string): string => content.slice(node.startIndex, node.endIndex);
const getLineFromIndex = (content: string, index: number): number => content.substring(0, index).split('\n').length;

const extractCodeSnippet = (symbolType: CodeNodeType, node: TSNode): string => {
  const text = node.text;
  switch (symbolType) {
    case 'variable': case 'constant': case 'property': {
      const assignmentMatch = text.match(/=\s*(.+)$/s);
      return (assignmentMatch?.[1] ?? text).trim();
    }
    case 'field': {
      const colonIndex = text.indexOf(':');
      if (colonIndex !== -1) return text.substring(colonIndex).trim();
      const equalsIndex = text.indexOf('=');
      if (equalsIndex !== -1) return text.substring(equalsIndex).trim();
      return text.trim();
    }
    case 'function': case 'method': case 'constructor': {
      const bodyStart = text.indexOf('{');
      return (bodyStart > -1 ? text.slice(0, bodyStart) : text).trim();
    }
    case 'arrow_function': {
      const arrowIndex = text.indexOf('=>');
      return arrowIndex > -1 ? text.slice(0, arrowIndex).trim() : text.trim();
    }
    default: return text.trim();
  }
};

const extractQualifiers = (childCaptures: TSMatch[], fileContent: string, handler: Partial<LanguageHandler>) => {
  const qualifiers: { [key: string]: TSNode } = {};
  for (const capture of childCaptures) qualifiers[capture.name] = capture.node;

  const visibility = (qualifiers['qualifier.visibility'] ? getNodeText(qualifiers['qualifier.visibility'], fileContent) : undefined) as CodeNodeVisibility | undefined;
  const returnType = qualifiers['symbol.returnType'] ? getNodeText(qualifiers['symbol.returnType'], fileContent).replace(/^:\s*/, '') : undefined;
  const parameters = qualifiers['symbol.parameters'] && handler.parseParameters ? handler.parseParameters(qualifiers['symbol.parameters'], fileContent) : undefined;
  const canThrow = childCaptures.some(c => c.name === 'qualifier.throws');

  return { qualifiers, visibility, returnType, parameters, canThrow, isAsync: !!qualifiers['qualifier.async'], isStatic: !!qualifiers['qualifier.static'] };
};

const getCssIntents = (ruleNode: TSNode, content: string): readonly ('layout' | 'typography' | 'appearance')[] => {
  const intents = new Set<'layout' | 'typography' | 'appearance'>();
  const layoutProps = /^(display|position|flex|grid|width|height|margin|padding|transform|align-|justify-)/;
  const typographyProps = /^(font|text-|line-height|letter-spacing|word-spacing)/;
  const appearanceProps = /^(background|border|box-shadow|opacity|color|fill|stroke|cursor)/;
  const block = ruleNode.childForFieldName('body') ?? ruleNode.namedChildren.find(c => c && c.type === 'block');

  if (block) {
    for (const declaration of block.namedChildren) {
      if (declaration && declaration.type === 'declaration') {
        const propNode = declaration.namedChildren.find(c => c && c.type === 'property_name');
        if (propNode) {
          const propName = getNodeText(propNode, content);
          if (layoutProps.test(propName)) intents.add('layout');
          if (typographyProps.test(propName)) intents.add('typography');
          if (appearanceProps.test(propName)) intents.add('appearance');
        }
      }
    }
  }
  return Array.from(intents).sort();
};

// --- LANGUAGE-SPECIFIC LOGIC ---

type LanguageHandler = {
  preProcessFile?: (file: FileContent, captures: TSMatch[]) => Record<string, any>;
  shouldSkipSymbol: (node: TSNode, symbolType: CodeNodeType, langName: string) => boolean;
  getSymbolNameNode: (declarationNode: TSNode, originalNode: TSNode) => TSNode | null;
  processComplexSymbol?: (context: ProcessSymbolContext) => boolean;
  parseParameters?: (paramsNode: TSNode, content: string) => { name: string; type?: string }[];
};

type ProcessSymbolContext = {
  nodes: CodeNode[];
  file: FileContent;
  node: TSNode;
  symbolType: CodeNodeType;
  processedSymbols: Set<string>;
  fileState: Record<string, any>;
  childCaptures: TSMatch[];
};

const pythonHandler: Partial<LanguageHandler> = {
  getSymbolNameNode: (declarationNode: TSNode) => {
    if (declarationNode.type === 'expression_statement') {
      const assignmentNode = declarationNode.namedChild(0);
      if (assignmentNode?.type === 'assignment') return assignmentNode.childForFieldName('left');
    }
    return declarationNode.childForFieldName('name');
  },
};

const goLangHandler: Partial<LanguageHandler> = {
  getSymbolNameNode: (declarationNode: TSNode) => {
    const nodeType = declarationNode.type;
    if (['type_declaration', 'const_declaration', 'var_declaration'].includes(nodeType)) {
      const spec = declarationNode.namedChild(0);
      if (spec && ['type_spec', 'const_spec', 'var_spec'].includes(spec.type)) return spec.childForFieldName('name');
    }
    return declarationNode.childForFieldName('name');
  },
};

const cLangHandler: Partial<LanguageHandler> = {
  getSymbolNameNode: (declarationNode: TSNode) => {
    if (declarationNode.type === 'type_definition') {
      const lastChild = declarationNode.namedChild(declarationNode.namedChildCount - 1);
      if (lastChild?.type === 'type_identifier') return lastChild;
    }
    if (declarationNode.type === 'function_definition') {
      const declarator = declarationNode.childForFieldName('declarator');
      if (declarator?.type === 'function_declarator') {
        const nameNode = declarator.childForFieldName('declarator');
        if (nameNode?.type === 'identifier') return nameNode;
      }
    }
    if (declarationNode.type === 'field_declaration') {
      const declarator = declarationNode.childForFieldName('declarator');
      if (declarator?.type === 'function_declarator') return declarator.childForFieldName('declarator');
      return declarator;
    }
    return declarationNode.childForFieldName('name');
  },
};

const tsLangHandler: Partial<LanguageHandler> = {
  preProcessFile: (_file, captures) => {
    const classNames = new Map<string, number>(); const duplicateClassNames = new Set<string>(); const seenClassNodes = new Set<number>();
    for (const { name, node } of captures) {
      if (name === 'class.definition') {
        let classNode = node.type === 'export_statement' ? (node.namedChildren[0] ?? node) : node;
        if (classNode.type === 'class_declaration' && !seenClassNodes.has(classNode.startIndex)) {
          seenClassNodes.add(classNode.startIndex);
          const nameNode = classNode.childForFieldName('name');
          if (nameNode) {
            const className = nameNode.text; const count = classNames.get(className) || 0;
            classNames.set(className, count + 1);
            if (count + 1 > 1) duplicateClassNames.add(className);
          }
        }
      }
    }
    return { duplicateClassNames };
  },
  shouldSkipSymbol: (node, symbolType, langName) => {
    if (langName !== 'typescript' && langName !== 'tsx') return false;
    const valueNode = node.childForFieldName('value');
    if (valueNode?.type !== 'arrow_function') return false;
    return (symbolType === 'field' && node.type === 'public_field_definition') || (symbolType === 'variable' && node.type === 'variable_declarator');
  },
  getSymbolNameNode: (declarationNode, originalNode) => {
    if (originalNode.type === 'variable_declarator' || originalNode.type === 'public_field_definition') return originalNode.childForFieldName('name');
    if (declarationNode.type === 'export_statement') {
      const { firstNamedChild } = declarationNode;
      if (firstNamedChild?.type === 'arrow_function') {
        // For export default arrow functions, create a synthetic 'default' name
        return null; // Will be handled by fallback logic below
      }
      // Handle `export default function() {}`
      if (firstNamedChild?.type === 'function_declaration' && !firstNamedChild.childForFieldName('name')) {
        return null; // Will be handled by fallback logic below
      }
      const lexicalDecl = declarationNode.namedChildren[0];
      if (lexicalDecl?.type === 'lexical_declaration') {
        const varDeclarator = lexicalDecl.namedChildren[0];
        if (varDeclarator?.type === 'variable_declarator') return varDeclarator.childForFieldName('name');
      }
    }
    return declarationNode.childForFieldName('name');
  },
  processComplexSymbol: ({ nodes, file, node, symbolType, processedSymbols, fileState, childCaptures }) => {
    if (symbolType !== 'method' && symbolType !== 'field') return false;
    const classParent = node.parent?.parent;
    if (classParent?.type === 'class_declaration') {
      const classNameNode = classParent.childForFieldName('name');
      if (classNameNode) {
        const className = classNameNode.text;
        const nameNode = node.childForFieldName('name');
        if (nameNode && !fileState['duplicateClassNames']?.has(className)) {
          const methodName = nameNode.text;
          const unqualifiedSymbolId = `${file.path}#${methodName}`;
          if (!processedSymbols.has(unqualifiedSymbolId) && !nodes.some(n => n.id === unqualifiedSymbolId)) {
            processedSymbols.add(unqualifiedSymbolId);
            const codeSnippet = extractCodeSnippet(symbolType, node);
            const q = extractQualifiers(childCaptures, file.content, tsLangHandler);
            const visibility = q.visibility; // Do not default to public, let it be undefined if not specified.
            nodes.push({
              id: unqualifiedSymbolId, type: symbolType, name: methodName, filePath: file.path,
              startLine: getLineFromIndex(file.content, node.startIndex), endLine: getLineFromIndex(file.content, node.endIndex),
              codeSnippet, ...(visibility && { visibility }), ...(q.isAsync && { isAsync: true }), ...(q.isStatic && { isStatic: true }),
              ...(q.returnType && { returnType: q.returnType }),
              ...(q.parameters && { parameters: q.parameters }), ...(q.canThrow && { canThrow: true }),
            });
          }
          processedSymbols.add(`${file.path}#${methodName}`);
        }
      }
    }
    return true;
  },
  parseParameters: (paramsNode: TSNode, content: string): { name: string; type?: string }[] => {
    const params: { name: string; type?: string }[] = [];
    // Handle object destructuring in props: `({ prop1, prop2 })`
    if (paramsNode.type === 'object_pattern') {
      for (const child of paramsNode.namedChildren) {
        if (child && (child.type === 'shorthand_property_identifier' || child.type === 'property_identifier')) {
          params.push({ name: getNodeText(child, content), type: '#' });
        }
      }
      return params;
    }

    for (const child of paramsNode.namedChildren) {
      if (child && (child.type === 'required_parameter' || child.type === 'optional_parameter')) {
        const nameNode = child.childForFieldName('pattern');
        const typeNode = child.childForFieldName('type');
        if (nameNode) params.push({ name: getNodeText(nameNode, content), type: typeNode ? getNodeText(typeNode, content).replace(/^:\s*/, '') : undefined });
      }
    }
    return params;
  },
};

const phpHandler: Partial<LanguageHandler> = {
  getSymbolNameNode: (declarationNode: TSNode) => {
    if (declarationNode.type === 'namespace_definition') return declarationNode.childForFieldName('name');
    return declarationNode.childForFieldName('name');
  },
};

const languageHandlers: Record<string, Partial<LanguageHandler>> = {
  default: { shouldSkipSymbol: () => false, getSymbolNameNode: (declarationNode) => declarationNode.childForFieldName('name') },
  typescript: tsLangHandler, tsx: tsLangHandler,
  python: pythonHandler, go: goLangHandler, rust: goLangHandler,
  c: cLangHandler, cpp: cLangHandler, php: phpHandler,
};

const getLangHandler = (langName: string): LanguageHandler => ({ ...languageHandlers['default'], ...languageHandlers[langName] } as LanguageHandler);

function getSymbolTypeFromCapture(captureName: string, type: string): CodeNodeType | null {
  const baseMap = new Map<string, CodeNodeType>([
    ['class', 'class'], ['function', 'function'], ['function.arrow', 'arrow_function'], ['interface', 'interface'],
    ['type', 'type'], ['method', 'method'], ['field', 'field'], ['struct', 'struct'], ['enum', 'enum'],
    ['namespace', 'namespace'], ['trait', 'trait'], ['impl', 'impl'], ['constructor', 'constructor'], ['property', 'property'],
    ['html.element', 'html_element'], ['css.rule', 'css_rule'], ['variable', 'variable'], ['constant', 'constant'],
    ['static', 'static'], ['union', 'union'], ['template', 'template'],
  ]);
  return baseMap.get(captureName) ?? baseMap.get(type) ?? null;
}

function findEnclosingSymbolId(startNode: TSNode, file: FileContent, nodes: readonly CodeNode[]): string | null {
  let current: TSNode | null = startNode.parent;
  while (current) {
    const nodeType = current.type;
    // Prioritize function-like parents for accurate call linking
    if (['function_declaration', 'method_definition', 'arrow_function', 'function_definition'].includes(nodeType)) {
      const nameNode = current.childForFieldName('name');
      if (nameNode) {
        let symbolName = nameNode.text;
        // Handle class methods
        if (nodeType === 'method_definition') {
          const classNode = current.parent?.parent;
          if (classNode?.type === 'class_declaration') {
            const className = classNode.childForFieldName('name')?.text;
            if (className) symbolName = `${className}.${symbolName}`;
          }
        }
        const symbolId = `${file.path}#${symbolName}`;
        if (nodes.some(n => n.id === symbolId)) return symbolId;
      }
    }
    // Fallback for other symbol types
    if (current.type === 'jsx_opening_element') {
      const tagNameNode = current.childForFieldName('name');
      if (tagNameNode) {
        const tagName = tagNameNode.text, lineNumber = tagNameNode.startPosition.row + 1;
        const symbolId = `${file.path}#${tagName}:${lineNumber}`;
        if (nodes.some(n => n.id === symbolId)) return symbolId;
      }
    }
    const nameNode = current.childForFieldName('name');
    if (nameNode) {
      let symbolName = nameNode.text;
      if (current.type === 'method_definition' || (current.type === 'public_field_definition' && !current.text.includes('=>'))) {
        const classNode = current.parent?.parent;
        if (classNode?.type === 'class_declaration') symbolName = `${classNode.childForFieldName('name')?.text}.${symbolName}`;
      }
      const symbolId = `${file.path}#${symbolName}`;
      if (nodes.some(n => n.id === symbolId)) return symbolId;
    }
    current = current.parent;
  }
  return file.path;
}

function processSymbol(context: ProcessSymbolContext, langConfig: LanguageConfig): void {
  const { nodes, file, node, symbolType, processedSymbols, childCaptures } = context;
  const handler = getLangHandler(langConfig.name);

  if (handler.shouldSkipSymbol(node, symbolType, langConfig.name)) return;
  if (handler.processComplexSymbol?.(context)) return;

  // Skip local variable declarations inside functions
  if (symbolType === 'variable') {
    let current = node.parent;
    while (current) {
      if (['function_declaration', 'arrow_function', 'method_definition'].includes(current.type)) {
        return; // Skip this variable as it's inside a function
      }
      current = current.parent;
    }
  }

  let declarationNode = node;
  // An entity is exported if its node is an export_statement, or if it's a declaration whose parent is an export_statement.
  if (node.type === 'export_statement' && node.namedChildCount > 0) declarationNode = node.namedChildren[0] ?? node;

  const q = extractQualifiers(childCaptures, file.content, handler);
  const visibility = q.visibility;
  let nameNode = handler.getSymbolNameNode(declarationNode, node) || q.qualifiers['html.tag'] || q.qualifiers['css.selector'];

  if (symbolType === 'css_rule' && !nameNode) {
    const selectorsNode = node.childForFieldName('selectors') || node.namedChildren.find(c => c && c.type === 'selectors');
    if (selectorsNode) nameNode = selectorsNode.namedChildren[0] ?? undefined;
  }

  let symbolName: string;
  if (!nameNode) {
    // Handle export default anonymous functions
    if (node.type === 'export_statement') {
      const firstChild = node.firstNamedChild;
      if (firstChild?.type === 'arrow_function' ||
        (firstChild?.type === 'function_declaration' && !firstChild.childForFieldName('name'))) {
        symbolName = 'default';
      } else {
        return;
      }
    } else {
      return;
    }
  } else {
    symbolName = nameNode.text;
  }

  let symbolId = `${file.path}#${symbolName}`;
  if (symbolType === 'html_element' && nameNode) symbolId = `${file.path}#${symbolName}:${nameNode.startPosition.row + 1}`;

  if (symbolName && !processedSymbols.has(symbolId) && !nodes.some(n => n.id === symbolId)) {
    processedSymbols.add(symbolId);
    const isHtmlElement = symbolType === 'html_element', isCssRule = symbolType === 'css_rule';
    const cssIntents = isCssRule ? getCssIntents(node, file.content) : undefined;
    const codeSnippet = extractCodeSnippet(symbolType, node);
    nodes.push({
      id: symbolId, type: symbolType, name: symbolName, filePath: file.path,
      startLine: getLineFromIndex(file.content, node.startIndex), endLine: getLineFromIndex(file.content, node.endIndex),
      codeSnippet, ...(visibility && { visibility }), ...(q.isAsync && { isAsync: true }), ...(q.isStatic && { isStatic: true }),
      ...(q.returnType && { returnType: q.returnType }),
      ...(q.parameters && { parameters: q.parameters }), ...(q.canThrow && { canThrow: true }),
      ...(isHtmlElement && { htmlTag: symbolName }), ...(isCssRule && { cssSelector: symbolName }),
      ...(cssIntents && { cssIntents }),
    });
  }
}

/**
 * Analyzes the content of a single file using a provided Tree-sitter parser.
 * This is the core, environment-agnostic analysis function.
 * @param context - An object containing the file content, language config, and an initialized parser.
 * @returns An object containing the extracted code nodes and unresolved relationships.
 */
export function analyzeFileContent({ file, langConfig, parser }: { file: FileContent; langConfig: LanguageConfig; parser: TSParser; }): { nodes: CodeNode[]; relations: UnresolvedRelation[] } {
  const nodes: CodeNode[] = [];
  const relations: UnresolvedRelation[] = [];
  const processedSymbols = new Set<string>();

  if (!parser.language) return { nodes, relations };

  const query = new Query(parser.language, langConfig.query);
  const tree = parser.parse(file.content);
  if (!tree) return { nodes, relations };
  const captures = query.captures(tree.rootNode);

  // --- Phase 1: Definitions ---
  const handler = getLangHandler(langConfig.name);
  const fileState = handler.preProcessFile?.(file, captures) || {};
  const definitionCaptures = captures.filter(({ name }) => name.endsWith('.definition'));
  const otherCaptures = captures.filter(({ name }) => !name.endsWith('.definition'));

  for (const { name, node } of definitionCaptures) {
    const parts = name.split('.');
    const type = parts.slice(0, -1).join('.');
    const symbolType = getSymbolTypeFromCapture(name, type);
    if (!symbolType) continue;

    const childCaptures = otherCaptures.filter((c) => c.node.startIndex >= node.startIndex && c.node.endIndex <= node.endIndex);
    processSymbol({ nodes, file, node, symbolType, processedSymbols, fileState, childCaptures }, langConfig);
  }

  // --- Phase 2: Relationships ---
  for (const { name, node } of captures) {
    const parts = name.split('.');
    const type = parts.slice(0, -1).join('.');
    const subtype = parts[parts.length - 1];

    if (type === 'import' && subtype === 'source') {
      const importPath = getNodeText(node, file.content).replace(/['"`]/g, '');
      relations.push({ fromId: file.path, toName: importPath, type: 'imports' });
      continue;
    }

    if (name === 'css.class.reference' || name === 'css.id.reference') {
      const fromId = findEnclosingSymbolId(node, file, nodes);
      if (!fromId) continue;

      const fromNode = nodes.find(n => n.id === fromId);
      if (fromNode?.type !== 'html_element') continue;

      const text = getNodeText(node, file.content).replace(/['"`]/g, '');
      const prefix = name === 'css.id.reference' ? '#' : '.';
      const selectors = (prefix === '.') ? text.split(' ').filter(Boolean).map(s => '.' + s) : [prefix + text];

      for (const selector of selectors) relations.push({ fromId, toName: selector, type: 'reference' });
      continue;
    }

    // Updated to handle more specific relationship types
    if (subtype && ['inheritance', 'implementation', 'call', 'reference'].includes(subtype)) {
      const fromId = findEnclosingSymbolId(node, file, nodes);
      if (!fromId) continue;

      const toName = getNodeText(node, file.content).replace(/<.*>$/, '');
      const edgeType = (subtype === 'inheritance' ? 'inherits' : subtype === 'implementation' ? 'implements' : subtype === 'call' ? 'calls' : 'reference') as UnresolvedRelation['type'];
      relations.push({ fromId, toName, type: edgeType });
    }
  }

  return { nodes, relations };
}
````

## File: packages/repograph-core/src/pipeline/rank.ts
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

## File: packages/repograph-core/src/pipeline/relation-resolver.ts
````typescript
import type { CodeNode, CodeEdge } from '../types';

/** A minimal API for path manipulation, to be provided by the environment. */
export interface PathAPI {
  normalize: (p: string) => string;
  dirname: (p: string) => string;
  join: (...args: string[]) => string;
  extname: (p: string) => string;
  parse: (p: string) => { dir: string; base: string; name: string; ext: string; root: string };
  basename: (p: string) => string;
}

type ImportResolver = (fromFile: string, sourcePath: string, allFiles: readonly string[]) => string | null;

/**
 * Creates a set of language-specific import resolvers.
 * @param path - An environment-specific path utility object.
 * @returns An object with a `getImportResolver` function.
 */
export const createLanguageImportResolvers = (path: PathAPI) => {
  const createModuleResolver = (extensions: string[]) => (fromFile: string, sourcePath: string, allFiles: readonly string[]): string | null => {
    const basedir = path.normalize(path.dirname(fromFile));
    const importPath = path.normalize(path.join(basedir, sourcePath));

    // First, check if the path as-is (with extension) exists
    if (path.extname(importPath) && allFiles.includes(importPath)) {
      return importPath;
    }

    const parsedPath = path.parse(importPath);
    const basePath = path.normalize(path.join(parsedPath.dir, parsedPath.name));

    // Try with extensions
    for (const ext of extensions) {
      const potentialFile = basePath + ext;
      if (allFiles.includes(potentialFile)) return potentialFile;
    }

    for (const ext of extensions) {
      const potentialIndexFile = path.normalize(path.join(importPath, 'index' + ext));
      if (allFiles.includes(potentialIndexFile)) return potentialIndexFile;
    }

    if (allFiles.includes(importPath)) return importPath;
    return null;
  };

  const resolveImportFactory = (endings: string[], packageStyle: boolean = false) => (fromFile: string, sourcePath: string, allFiles: readonly string[]): string | null => {
    const basedir = path.normalize(path.dirname(fromFile));
    const resolvedPathAsIs = path.normalize(path.join(basedir, sourcePath));
    if (allFiles.includes(resolvedPathAsIs)) return resolvedPathAsIs;

    const parsedSourcePath = path.parse(sourcePath);
    const basePath = path.normalize(path.join(basedir, parsedSourcePath.dir, parsedSourcePath.name));
    for (const end of endings) {
      const potentialPath = basePath + end;
      if (allFiles.includes(potentialPath)) return potentialPath;
    }

    if (packageStyle && sourcePath.includes('.')) {
      const packagePath = path.normalize(sourcePath.replace(/\./g, '/'));
      for (const end of endings) {
        const fileFromRoot = packagePath + end;
        if (allFiles.includes(fileFromRoot)) return fileFromRoot;
      }
    }
    return null;
  };

  const languageImportResolvers: Record<string, ImportResolver> = {
    default: (fromFile, sourcePath, allFiles) => {
      const resolvedPathAsIs = path.normalize(path.join(path.dirname(fromFile), sourcePath));
      return allFiles.includes(resolvedPathAsIs) ? resolvedPathAsIs : null;
    },
    typescript: createModuleResolver(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css']),
    javascript: createModuleResolver(['.js', '.jsx', '.mjs', '.cjs']),
    tsx: createModuleResolver(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css']),
    python: (fromFile: string, sourcePath: string, allFiles: readonly string[]): string | null => {
      if (sourcePath.startsWith('.')) {
        const level = sourcePath.match(/^\.+/)?.[0]?.length ?? 0;
        const modulePath = sourcePath.substring(level).replace(/\./g, '/');
        let currentDir = path.normalize(path.dirname(fromFile));
        for (let i = 1; i < level; i++) currentDir = path.dirname(currentDir);
        const targetPyFile = path.normalize(path.join(currentDir, modulePath) + '.py');
        if (allFiles.includes(targetPyFile)) return targetPyFile;
        const resolvedPath = path.normalize(path.join(currentDir, modulePath, '__init__.py'));
        if (allFiles.includes(resolvedPath)) return resolvedPath;
      }
      return resolveImportFactory(['.py', '/__init__.py'], true)(fromFile, sourcePath, allFiles);
    },
    java: resolveImportFactory(['.java'], true),
    csharp: resolveImportFactory(['.cs'], true),
    php: resolveImportFactory(['.php']),
    rust: (fromFile: string, sourcePath: string, allFiles: readonly string[]): string | null => {
      const basedir = path.normalize(path.dirname(fromFile));
      const resolvedPath = path.normalize(path.join(basedir, sourcePath + '.rs'));
      if (allFiles.includes(resolvedPath)) return resolvedPath;
      return resolveImportFactory(['.rs', '/mod.rs'])(fromFile, sourcePath, allFiles);
    },
  };

  const getImportResolver = (langName: string): ImportResolver => languageImportResolvers[langName] ?? languageImportResolvers['default']!;

  return { getImportResolver };
};


/** Resolves symbol references within a project graph. */
export class SymbolResolver {
  private fileImports = new Map<string, string[]>();

  constructor(private nodes: ReadonlyMap<string, CodeNode>, edges: readonly CodeEdge[]) {
    for (const edge of edges) {
      if (edge.type === 'imports') {
        if (!this.fileImports.has(edge.fromId)) this.fileImports.set(edge.fromId, []);
        this.fileImports.get(edge.fromId)!.push(edge.toId);
      }
    }
  }

  resolve(symbolName: string, contextFile: string): CodeNode | null {
    // 1. Same file
    const sameFileId = `${contextFile}#${symbolName}`;
    if (this.nodes.has(sameFileId)) return this.nodes.get(sameFileId)!;

    // 2. Imported files
    const importedFiles = this.fileImports.get(contextFile) || [];
    for (const file of importedFiles) {
      const importedId = `${file}#${symbolName}`;
      if (this.nodes.has(importedId)) return this.nodes.get(importedId)!;
    }

    // 3. CSS Selector
    for (const node of this.nodes.values()) {
        if (node.type === 'css_rule' && node.cssSelector === symbolName) return node;
    }

    // 4. Global fallback
    for (const node of this.nodes.values()) {
      if (node.name === symbolName && ['class', 'function', 'interface', 'struct', 'type', 'enum'].includes(node.type)) {
        return node;
      }
    }

    return null;
  }
}
````

## File: packages/repograph-core/src/pipeline/render.ts
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

    // Handle `includeMermaidGraph` and deprecated `noMermaid` option.
    // `includeMermaidGraph` takes precedence.
    let includeMermaidGraph = true; // Default value
    if (options.includeMermaidGraph !== undefined) {
      includeMermaidGraph = options.includeMermaidGraph;
    } else if (options.noMermaid !== undefined) {
      logger.warn('The `noMermaid` renderer option is deprecated and will be removed in a future version. Please use `includeMermaidGraph: false` instead.');
      includeMermaidGraph = !options.noMermaid;
    }

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

## File: packages/repograph-core/src/tree-sitter/language-config.ts
````typescript
export interface LanguageConfig {
  name: string;
  extensions: string[];
  wasmPath: string;
  query: string;
}
export interface LoadedLanguage {
  config: LanguageConfig;
  // This is the actual tree-sitter Language object. Using `any` to keep `repograph-core`
  // agnostic of the environment-specific parser (`tree-sitter` vs `web-tree-sitter`).
  language: any;
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

(new_expression
  constructor: (identifier) @function.call)

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
    wasmPath: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
    query: TS_BASE_QUERY
  },
  {
    name: 'tsx',
    extensions: ['.tsx', '.jsx'],
    wasmPath: 'tree-sitter-typescript/tree-sitter-tsx.wasm',
    query: `${TS_BASE_QUERY}\n${TSX_SPECIFIC_QUERY}`
  },
  {
    name: 'python',
    extensions: ['.py', '.pyw'],
    wasmPath: 'tree-sitter-python/tree-sitter-python.wasm',
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
    wasmPath: 'tree-sitter-java/tree-sitter-java.wasm',
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
    wasmPath: 'tree-sitter-cpp/tree-sitter-cpp.wasm',
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
    wasmPath: 'tree-sitter-c/tree-sitter-c.wasm',
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
    wasmPath: 'tree-sitter-go/tree-sitter-go.wasm',
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
    wasmPath: 'tree-sitter-rust/tree-sitter-rust.wasm',
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
    wasmPath: 'tree-sitter-c-sharp/tree-sitter-c_sharp.wasm',
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
    wasmPath: 'tree-sitter-php/tree-sitter-php.wasm',
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
    wasmPath: 'tree-sitter-ruby/tree-sitter-ruby.wasm',
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
    wasmPath: 'tree-sitter-solidity/tree-sitter-solidity.wasm',
    query: `
      (contract_declaration) @class.definition
      (function_definition) @function.definition
      (event_definition) @enum.definition
    `
  },
  {
    name: 'swift',
    extensions: ['.swift'],
    wasmPath: 'tree-sitter-swift/tree-sitter-swift.wasm',
    query: `
      (class_declaration) @class.definition
      (protocol_declaration) @trait.definition
      (function_declaration) @function.definition
      (protocol_function_declaration) @function.definition
      (property_declaration) @field.definition
    `
  },
  {
    name: 'vue',
    extensions: ['.vue'],
    wasmPath: 'tree-sitter-vue/tree-sitter-vue.wasm',
    query: `
      (script_element .
        [
          (lexical_declaration (variable_declarator)) @variable.definition
          (function_declaration) @function.definition
        ])

      (element
        (start_tag
          (tag_name) @html.tag
        )
      ) @html.element.definition
  `
  },
  {
    name: 'css',
    extensions: ['.css'],
    wasmPath: 'tree-sitter-css/tree-sitter-css.wasm',
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

## File: packages/repograph-core/src/types/graphology-pagerank.d.ts
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

## File: packages/repograph-core/src/utils/error.util.ts
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

## File: packages/repograph-core/src/utils/logger.util.ts
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

## File: packages/repograph-core/src/index.ts
````typescript
// Core types
export type {
  Analyzer,
  FileDiscoverer,
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

// Core pipeline analysis logic
export { analyzeFileContent } from './pipeline/analysis-logic';
export { SymbolResolver, createLanguageImportResolvers } from './pipeline/relation-resolver';
export type { PathAPI } from './pipeline/relation-resolver';

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

## File: packages/repograph-core/src/types.ts
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
  customHeader?: string;
  /** Include the default `RepoGraph` header. @default true */
  includeHeader?: boolean;
  /** Include the project overview section. @default true */
  includeOverview?: boolean;
  /** Include a Mermaid.js dependency graph. @default true */
  includeMermaidGraph?: boolean;
  /** @deprecated Use `includeMermaidGraph: false` instead. Will be removed in a future version. */
  noMermaid?: boolean;
  /** Include the list of top-ranked files. @default true */
  includeFileList?: boolean;
  /** Number of files to show in the top list. @default 10 */
  topFileCount?: number;
  /** Include detailed breakdowns for each symbol. @default true */
  includeSymbolDetails?: boolean;
  /** String to use as a separator between file sections. @default '---' */
  fileSectionSeparator?: string;

  /** Options for how individual symbols are rendered */
  symbolDetailOptions?: {
    /** Include relationships (calls, inherits, etc.) in the symbol line. @default true */
    includeRelations?: boolean;
    /** Include the starting line number. @default true */
    includeLineNumber?: boolean;
    /** Include the code snippet for the symbol. @default true */
    includeCodeSnippet?: boolean;
    /** Max number of relations to show per type (e.g., 'calls'). @default 3 */
    maxRelationsToShow?: number;
  };
};

// Low-Level Functional Pipeline Contracts

/** Discovers files in a repository based on provided options. */
export type FileDiscoverer = (options: {
  readonly root: string;
  readonly include?: readonly string[];
  readonly ignore?: readonly string[];
  readonly noGitignore?: boolean;
}) => Promise<readonly FileContent[]>;

/** Analyzes file content and builds the dependency graph. */
export type Analyzer = (files: readonly FileContent[]) => Promise<CodeGraph>;

/** Ranks the nodes in a graph. */
export type Ranker = (graph: CodeGraph) => Promise<RankedCodeGraph>;

/** Renders a ranked graph into a string format. */
export type Renderer = (rankedGraph: RankedCodeGraph, options?: RendererOptions) => string;
````

## File: packages/repograph-core/package.json
````json
{
  "name": "repograph-core",
  "version": "0.1.20",
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

## File: packages/repograph-core/tsconfig.json
````json
{
  "compilerOptions": {
    // Environment setup & latest features
    "lib": ["ESNext"],
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
    "noPropertyAccessFromIndexSignature": true,

    "types": ["bun-types"]
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "dist"]
}
````

## File: packages/repograph-core/tsup.config.ts
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

## File: packages/scn-ts/src/cli.ts
````typescript
import { generateScn, type ScnTsConfig } from './index.js';
import { existsSync, readFileSync, watch } from 'fs';
import { writeFile, readdir, mkdir, copyFile } from 'fs/promises';
import { resolve, relative, dirname, join } from 'path';
import { version } from '../package.json';
import { createRequire } from 'node:module';

interface CliOptions {
  include: string[];
  output?: string;
  project?: string;
  config?: string;
  maxWorkers?: number;
  watch: boolean;
  help: boolean;
  version: boolean;
}

const copyWasmFiles = async (destination: string) => {
  try {
    const require = createRequire(import.meta.url);
    const repographMainPath = require.resolve('repograph');
    const sourceDir = resolve(dirname(repographMainPath), 'wasm');

    if (!existsSync(sourceDir)) {
      console.error(
        `[SCN-TS] Error: Could not find WASM files directory for 'repograph'. Looked in ${sourceDir}. Please check your 'repograph' installation.`,
      );
      process.exit(1);
    }

    await mkdir(destination, { recursive: true });

    const wasmFiles = (await readdir(sourceDir)).filter((file) => file.endsWith('.wasm'));
    if (wasmFiles.length === 0) {
      console.error(
        `[SCN-TS] Error: No WASM files found in ${sourceDir}. This might be an issue with the 'repograph' package installation.`,
      );
      process.exit(1);
    }
    for (const file of wasmFiles) {
      const srcPath = join(sourceDir, file);
      const destPath = join(destination, file);
      await copyFile(srcPath, destPath);
      console.error(`[SCN-TS] Copied ${file} to ${relative(process.cwd(), destPath)}`);
    }
    console.error(`\n[SCN-TS] All ${wasmFiles.length} WASM files copied successfully.`);
  } catch (err) {
    console.error('[SCN-TS] Error copying WASM files.', err);
  }
};

const ARG_CONFIG: Record<string, { key: keyof CliOptions; takesValue: boolean }> = {
  '-o': { key: 'output', takesValue: true },
  '--output': { key: 'output', takesValue: true },
  '-p': { key: 'project', takesValue: true },
  '--project': { key: 'project', takesValue: true },
  '-c': { key: 'config', takesValue: true },
  '--config': { key: 'config', takesValue: true },
  '--max-workers': { key: 'maxWorkers', takesValue: true },
  '--watch': { key: 'watch', takesValue: false },
  '-h': { key: 'help', takesValue: false },
  '--help': { key: 'help', takesValue: false },
  '-v': { key: 'version', takesValue: false },
  '--version': { key: 'version', takesValue: false },
};

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    include: [],
    watch: false,
    help: false,
    version: false,
  };
  const cliArgs = args.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];
    if (!arg) continue;
    const config = ARG_CONFIG[arg];
    if (config) {
      if (config.takesValue) {
        const value = cliArgs[++i];
        if (value === undefined) {
          console.error(`Error: Missing value for argument ${arg}`);
          process.exit(1);
        }
        if (config.key === 'maxWorkers') {
          const numValue = parseInt(value, 10);
          if (isNaN(numValue) || numValue < 1) {
            console.error(`Invalid value for --max-workers: ${value}. Must be a positive integer.`);
            process.exit(1);
          }
          (options as any)[config.key] = numValue;
        } else {
          (options as any)[config.key] = value;
        }
      } else {
        (options as any)[config.key] = true;
      }
    } else if (arg.startsWith('-')) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    } else {
      options.include.push(arg);
    }
  }

  return options;
}

async function loadConfig(configPath?: string): Promise<Partial<ScnTsConfig> & { output?: string }> {
  const path = resolve(process.cwd(), configPath || 'scn.config.js');
  if (existsSync(path)) {
    try {
      if (path.endsWith('.js')) {
        const configModule = await import(path);
        return configModule.default || configModule;
      }
      if (path.endsWith('.json')) {
         return JSON.parse(readFileSync(path, 'utf-8'));
      }
    } catch (e) {
      console.error(`Error loading config file: ${path}`);
      console.error(e);
      process.exit(1);
    }
  }
  return {};
}

function showHelp() {
  console.log(`
  scn-ts v${version}

  Generates a Symbolic Context Notation map from a TypeScript/JavaScript project.

  Usage:
    scn-ts [globs...] [options]
    scn-ts copy-wasm [destination]

  Arguments:
    globs...         Glob patterns specifying files to include.

  Commands:
    [globs...]       (default) Analyze a repository at the given path.
    copy-wasm        Copy Tree-sitter WASM files to a directory for browser usage.

  Arguments:
    globs...         Glob patterns specifying files to include.
    destination      For 'copy-wasm', the destination directory. (default: ./public/wasm)


  Options:
    -o, --output <path>      Path to write the SCN output file. (default: stdout)
    -p, --project <path>     Path to tsconfig.json.
    -c, --config <path>      Path to a config file. (default: scn.config.js)
    --max-workers <num>      Number of parallel workers for analysis. (default: 1)
    --watch                  Watch files for changes and re-generate.
    -v, --version            Display version number.
    -h, --help               Display this help message.
  `);
}

async function run() {
  const cliArgs = process.argv.slice(2);

  if (cliArgs[0] === 'copy-wasm') {
    const destDir = cliArgs[1] || './public/wasm';
    console.error(`[SCN-TS] Copying WASM files to "${resolve(destDir)}"...`);
    await copyWasmFiles(destDir);
    return;
  }
  const cliOptions = parseArgs(process.argv);

  if (cliOptions.version) {
    console.log(version);
    return;
  }

  if (cliOptions.help) {
    showHelp();
    return;
  }

  const fileConfig = await loadConfig(cliOptions.config);

  const config: ScnTsConfig = {
    root: process.cwd(),
    include: cliOptions.include.length > 0 ? cliOptions.include : fileConfig.include,
    exclude: fileConfig.exclude,
    project: cliOptions.project || fileConfig.project,
    maxWorkers: cliOptions.maxWorkers || fileConfig.maxWorkers,
  };

  const output = cliOptions.output || fileConfig.output;

  if (!config.include || config.include.length === 0) {
    console.error('Error: No input files specified. Provide glob patterns as arguments or in a config file.');
    showHelp();
    process.exit(1);
  }

  const executeGeneration = async () => {
    try {
      console.error(`[SCN-TS] Analyzing project...`);
      const scn = await generateScn(config);
      if (output) {
        await writeFile(output, scn, 'utf-8');
        console.error(`[SCN-TS] SCN map written to ${relative(process.cwd(), output)}`);
      } else {
        console.log(scn);
      }
    } catch (e: any) {
      console.error(`[SCN-TS] Error during generation: ${e.message}`);
      if (!cliOptions.watch) {
         process.exit(1);
      }
    }
  };

  await executeGeneration();

  if (cliOptions.watch) {
    console.error('[SCN-TS] Watching for file changes...');
    watch(config.root || process.cwd(), { recursive: true }, async (_eventType, filename) => {
        if (filename) {
            console.error(`[SCN-TS] Change detected in '${filename}'. Re-generating...`);
            await executeGeneration();
        }
    });
  }
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
````

## File: packages/scn-ts/src/index.ts
````typescript
import { analyzeProject } from 'repograph';
import type { RankedCodeGraph, RepoGraphOptions } from 'repograph';
import { serializeGraph } from './serializer';

export interface ScnTsConfig {
  /**
   * The root directory of the project to analyze. Defaults to the current working directory.
   * Not used if `files` is provided.
   */
  root?: string;
  /**
   * Glob patterns for files to include. Required if `files` is not provided.
   */
  include?: string[];
  /** Glob patterns for files to exclude. */
  exclude?: string[];
  /**
   * For browser or in-memory usage, provide file contents directly. This will
   * bypass all file-system operations (`root`, `include`, `exclude`).
   */
  files?: readonly { path: string; content: string }[];
  /** Path to the project's tsconfig.json. (Not currently used by repograph) */
  project?: string;
  /**
   * The maximum number of parallel workers to use for analysis.
   * When set to 1, analysis runs in the main thread without workers.
   * For faster test execution, use higher values (e.g., 4-8).
   * @default 1
   */
  maxWorkers?: number;
  /** (Future) An array of language parser plugins. */
  // plugins?: unknown[];
}

/**
 * High-level API to generate an SCN context map from a project.
 *
 * This function orchestrates the entire process:
 * 1. Invokes `repograph` to analyze the codebase and build a `RankedCodeGraph`.
 * 2. Serializes the resulting graph into the SCN text format.
 *
 * @param config - The configuration specifying which files to analyze.
 * @returns A promise that resolves to the SCN map as a string.
 */
export const generateScn = async (config: ScnTsConfig): Promise<string> => {
  // 1. repograph analyzes the project and returns a structured graph.
  const repoGraphOptions: RepoGraphOptions = {
    root: config.root,
    include: config.include,
    ignore: config.exclude,
    maxWorkers: config.maxWorkers,
    files: config.files,
    // We can set other repograph options here if needed, e.g. rankingStrategy
  };
  const graph: RankedCodeGraph = await analyzeProject(repoGraphOptions);

  // 2. scn-ts serializes that graph into the SCN text format.
  const scnOutput = serializeGraph(graph, config.root);
  return scnOutput;
};

// Low-level API for composition
export { serializeGraph };

// Re-export from repograph for advanced users
export {
  // High-Level API
  analyzeProject,
  generateMap,
  // Low-Level API
  createMapGenerator,
  // Pipeline component factories
  createDefaultDiscoverer,
  createTreeSitterAnalyzer,
  createPageRanker,
  createGitRanker,
  createMarkdownRenderer,
  // Logger utilities
  logger,
  initializeParser,
} from 'repograph';

// Re-export types from repograph
export type {
  // Core types
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
  // Logger types
  Logger,
  LogLevel,
  // Parser types
  ParserInitializationOptions,
} from 'repograph';
````

## File: packages/scn-ts/src/serializer.ts
````typescript
import type {
  RankedCodeGraph,
  CodeNode,
  CodeEdge as RepographEdge,
  CssIntent,
  CodeNodeType,
} from "repograph";

// Allow for 'contains' and 'references' edges which might be produced by repograph
// but not present in a minimal type definition.
type CodeEdge = Omit<RepographEdge, 'type'> & {
  type: RepographEdge['type'] | 'contains' | 'references';
};
import { readFileSync } from "fs";
import { join } from "path";

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

class ScnIdManager {
  private fileIdCounter = 1;
  private entityIdCounters = new Map<string, number>(); // file path -> counter
  private repographIdToScnId = new Map<string, string>();
  private fileRepoIdToPath = new Map<string, string>();

  constructor(sortedFileNodes: CodeNode[], nodesByFile: Map<string, CodeNode[]>) {
    for (const fileNode of sortedFileNodes) {
      const fileId = `${this.fileIdCounter++}`;
      this.repographIdToScnId.set(fileNode.id, fileId);
      this.fileRepoIdToPath.set(fileNode.id, fileNode.filePath);
      this.entityIdCounters.set(fileNode.filePath, 1);

      const entities = nodesByFile.get(fileNode.filePath) || [];
      entities.sort((a, b) => a.startLine - b.startLine);

      for (const entityNode of entities) {
        const entityCounter = this.entityIdCounters.get(entityNode.filePath)!;
        const entityId = `${fileId}.${entityCounter}`;
        this.repographIdToScnId.set(entityNode.id, entityId);
        this.entityIdCounters.set(entityNode.filePath, entityCounter + 1);
      }
    }
  }

  getScnId(repographId: string): string | undefined {
    return this.repographIdToScnId.get(repographId);
  }

  isFilePath(repographId: string): boolean {
    return this.fileRepoIdToPath.has(repographId);
  }
}

// Cache for source file contents to avoid reading files multiple times
const sourceFileCache = new Map<string, string>();

const getSourceContent = (filePath: string, rootDir?: string): string => {
  const fullPath = rootDir ? join(rootDir, filePath) : filePath;
  if (!sourceFileCache.has(fullPath)) {
    try {
      const content = readFileSync(fullPath, 'utf-8');
      sourceFileCache.set(fullPath, content);
    } catch {
      sourceFileCache.set(fullPath, '');
    }
  }
  return sourceFileCache.get(fullPath) || '';
};

const getVisibilitySymbol = (node: CodeNode, rootDir?: string): '+' | '-' | undefined => {
  if (node.visibility === 'public') return '+';
  if (node.visibility === 'private' || node.visibility === 'protected') return '-';
  if (node.type === 'file') return undefined;

  // Fallback to source-based inference if repograph doesn't provide visibility.
  const source = getSourceContent(node.filePath, rootDir);
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

const getQualifiers = (node: CodeNode, rootDir?: string): { access?: '+' | '-'; others: QualifierSymbol[] } => {
  const access = getVisibilitySymbol(node, rootDir);

  const others: QualifierSymbol[] = [];

  // Check for async
  const isAsync = node.isAsync || (node.codeSnippet && /\basync\s+/.test(node.codeSnippet));
  if (isAsync) others.push('...');

  // Check for throw
  const canThrow = node.canThrow || (node.codeSnippet && /\bthrow\b/.test(node.codeSnippet));
  if (canThrow) others.push('!');

  // Check for pure function heuristic
  const isPure = node.isPure || isPureFunction(node, rootDir);
  if (isPure) others.push('o');

  return { access, others };
};

const isPureFunction = (node: CodeNode, rootDir?: string): boolean => {
  if (!['function', 'method', 'arrow_function'].includes(node.type)) return false;
  if (!node.codeSnippet) return false;

  // Get the full source to analyze the function body
  const source = getSourceContent(node.filePath, rootDir);
  if (!source) return false;

  const lines = source.split('\n');
  const startLine = node.startLine - 1;
  const endLine = node.endLine - 1;

  if (startLine < 0 || endLine >= lines.length) return false;

  const functionBody = lines.slice(startLine, endLine + 1).join('\n');

  // Simple heuristics for pure functions
  const impurePatterns = [
    /console\./,
    /document\./,
    /window\./,
    /localStorage/,
    /sessionStorage/,
    /fetch\(/,
    /XMLHttpRequest/,
    /setTimeout/,
    /setInterval/,
    /Math\.random/,
    /Date\(/,
    /new Date/,
    /\.push\(/,
    /\.pop\(/,
    /\.shift\(/,
    /\.unshift\(/,
    /\.splice\(/,
    /\.sort\(/,
    /\.reverse\(/,
    /\+\+/,
    /--/,
    /\w+\s*=\s*(?!.*return)/,
  ];

  // If it contains any impure patterns, it's not pure
  if (impurePatterns.some(pattern => pattern.test(functionBody))) {
    return false;
  }

  // If it only contains return statements and basic operations, likely pure
  const hasOnlyReturn = /^\s*export\s+(?:async\s+)?function\s+\w+\([^)]*\)(?:\s*:\s*[^{]+)?\s*{\s*return\s+[^;]+;\s*}\s*$/.test(functionBody.replace(/\n/g, ' '));

  return hasOnlyReturn;
};

const formatCssIntents = (intents: readonly CssIntent[] = []): string => {
  if (intents.length === 0) return '';
  // Sort intents alphabetically first, then map to symbols
  const sortedIntents = [...intents].sort();
  const symbols = sortedIntents.map(intent => CSS_INTENT_TO_SYMBOL[intent] ?? '');
  return `{ ${symbols.join(' ')} }`;
};

const formatFunctionSignature = (snippet: string): string => {
  // Find parameters part, e.g., (a: string, b: number)
  const paramsMatch = snippet.match(/\(([^)]*)\)/);
  let params = '()';
  if (paramsMatch && paramsMatch[1] !== undefined) {
    // Replace type annotations with #
    const paramContent = paramsMatch[1].replace(/:[^\,)]+/g, ': #');
    params = `(${paramContent})`;
  }

  // Find return type, e.g., ): string
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

const formatSignature = (node: CodeNode, rootDir?: string): string => {
  if (isComponentNode(node)) {
    // For components, we need to extract props from the full function signature
    // Get the source content to find the complete function definition
    const source = getSourceContent(node.filePath, rootDir);
    if (source) {
      const lines = source.split('\n');
      const startLine = node.startLine - 1;
      const endLine = Math.min(startLine + 10, lines.length); // Look at more lines to get the full signature

      // Look for the complete function signature in the source
      const functionText = lines.slice(startLine, endLine).join('\n');

      // Try multiple patterns to match React component props
      const patterns = [
        /function\s+\w+\s*\(\s*\{\s*([^}]+)\s*\}\s*:\s*\{[^}]*\}/,  // function Name({ prop1, prop2 }: { ... })
        /\(\s*\{\s*([^}]+)\s*\}\s*:\s*\{[^}]*\}/,                   // ({ prop1, prop2 }: { ... })
        /\(\s*\{\s*([^}]+)\s*\}[^)]*\)/,                            // ({ prop1, prop2 })
      ];

      for (const pattern of patterns) {
        const propMatch = functionText.match(pattern);
        if (propMatch?.[1]) {
          const props = propMatch[1].split(',').map(p => p.trim().split(/[:=]/)[0]?.trim()).filter(Boolean);
          const propsString = props.map(p => `${p}:#`).join(', ');
          return `{ props: { ${propsString} } }`;
        }
      }
    }
    return ''; // Component with no destructured props
  }

  // For functions, format as name() instead of showing full code snippet
  if ((node.type === 'function' || node.type === 'method' || node.type === 'constructor' || node.type === 'arrow_function') && node.codeSnippet) {
    return formatFunctionSignature(node.codeSnippet);
  }

  // For JSX/HTML elements, show attributes
  if (node.type === 'html_element' && node.codeSnippet) {
    return formatJsxAttributes(node.codeSnippet);
  }

  // For CSS rules, show intents
  if (node.type === 'css_rule' && node.cssIntents) {
    return formatCssIntents(node.cssIntents);
  }

  // For type aliases, show the aliased type
  if (node.type === 'type' && node.codeSnippet) {
     const match = node.codeSnippet.match(/=\s*(.+);?/);
     return match?.[1] ? `= ${match[1].trim().replace(/;$/, '')}` : '';
  }

  // For variables/constants, show the value if it's simple
  if ((node.type === 'variable' || node.type === 'constant') && node.codeSnippet) {
    // For uppercase constants that are treated as modules (◇ symbol), show different formatting
    if (/^[A-Z]/.test(node.name)) {
      // If it's an object literal, show it without = prefix (module pattern)
      if (node.codeSnippet.startsWith('{') && node.codeSnippet.endsWith('}')) {
        return node.codeSnippet;
      }
    }

    // For regular variables/constants, add = prefix if needed
    if (!node.codeSnippet.includes('=')) {
      return `= ${node.codeSnippet}`;
    }
    // Extract simple values like "123", "'value'", etc.
    const match = node.codeSnippet.match(/=\s*(.+)$/);
    if (match && match[1]) {
      return `= ${match[1].trim()}`;
    }
    // If no assignment found, just return the snippet
    return node.codeSnippet;
  }

  // For container types like class/interface/namespace, we don't show a signature.
  // Their contents are represented by nested symbols.
  if (node.type === 'class' || node.type === 'interface' || node.type === 'namespace') {
    return '';
  }

  return '';
};

const formatNode = (node: CodeNode, graph: RankedCodeGraph, idManager: ScnIdManager, rootDir?: string, level = 0): string => {
  const symbol = getNodeSymbol(node);
  const { access, others } = getQualifiers(node, rootDir);
  const signature = formatSignature(node, rootDir);
  const scnId = idManager.getScnId(node.id);
  const id = scnId ? `(${scnId})` : '';
  const indent = '  '.repeat(level + 1);

  // Build the main line: qualifiers symbol id name signature
  const parts = [];
  if (access) parts.push(access);
  parts.push(symbol);
  if (id) parts.push(id);

  // For functions, combine name and signature without space, unless it's a component
  if (['function', 'method', 'constructor', 'arrow_function'].includes(node.type) && !isComponentNode(node)) {
    const displayName = node.name.includes('.') ? node.name.split('.').pop() || node.name : node.name;
    parts.push(displayName + signature);
  } else {
    const displayName = (node.type === 'property' || node.type === 'field' || node.type === 'html_element') && node.name.includes('.')
      ? node.name.split('.').pop() || node.name
      : node.name;
    parts.push(displayName);
    if (signature) parts.push(signature);
  }

  let mainLine = indent + parts.join(' ');
  if (others.length > 0) {
    // Sort qualifiers in specific order: ... ! o
    const sortedOthers = others.sort((a, b) => {
      const order = ['...', '!', 'o'];
      return order.indexOf(a) - order.indexOf(b);
    });
    mainLine += ` ${sortedOthers.join(' ')}`;
  }

  const formatLinks = (prefix: string, edges: readonly CodeEdge[]): string => {
    if (edges.length === 0) return '';
    const links = edges.map((edge: CodeEdge) => {
      const isCallerLink = prefix === '<-';
      const targetRepographId = isCallerLink ? edge.fromId : edge.toId;
      const targetNode = graph.nodes.get(targetRepographId);
      let targetScnId = idManager.getScnId(targetRepographId);

      // Per spec, file-level dependencies use a .0 suffix.
      // This applies if the target of the link is a file itself.
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

    // For entity nodes, exclude file-level imports entirely
    if (node.type !== 'file' && edge.type === 'imports') return false;

    // For entity nodes, also exclude edges from file nodes (file-level dependencies)
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
  idManager: ScnIdManager,
  rootDir?: string
): string => {
  const scnId = idManager.getScnId(fileNode.id) ?? '';

  const formatFileLinks = (prefix: string, edges: readonly CodeEdge[]): string => {
    if (edges.length === 0) return '';
    const links = edges.map((edge: CodeEdge) => {
      const targetId = prefix === '->' ? edge.toId : edge.fromId;
      const targetNode = graph.nodes.get(targetId);

      // If the target is an entity (not a file), we need to get its file's ID
      let fileId: string;
      if (targetNode?.type === 'file') {
        fileId = targetId;
      } else {
        // Find the file that contains this entity
        const entityFilePath = targetNode?.filePath;
        const fileNode = Array.from(graph.nodes.values()).find(n => n.type === 'file' && n.filePath === entityFilePath);
        fileId = fileNode?.id || targetId;
      }

      const targetScnId = idManager.getScnId(fileId);
      return `(${targetScnId}.0)`;
    }).filter(Boolean);

    // Remove duplicates and sort
    const uniqueLinks = [...new Set(links)].sort().join(', ');
    if (!uniqueLinks) return '';
    return `\n  ${prefix} ${uniqueLinks}`;
  };

  // File-level dependencies: imports or calls from this file to other files
  const fileDependencies = graph.edges.filter(e =>
    e.fromId === fileNode.id &&
    (e.type === 'imports' || (e.type === 'calls' && graph.nodes.get(e.toId)?.type !== 'file'))
  );

  // File-level callers: imports or calls to entities in this file from other files
  const fileCallers = graph.edges.filter(e => {
    const toNode = graph.nodes.get(e.toId);
    const fromNode = graph.nodes.get(e.fromId);

    // If the target is an entity in this file and the source is from a different file
    return toNode?.filePath === fileNode.filePath &&
           fromNode?.filePath !== fileNode.filePath &&
           (e.type === 'imports' || e.type === 'calls');
  });

  const formattedPath = fileNode.filePath.includes(' ') ? `"${fileNode.filePath}"` : fileNode.filePath;
  let header = `§ (${scnId}) ${formattedPath}`;
  const fileDepLine = formatFileLinks('->', fileDependencies);
  if (fileDepLine) header += fileDepLine;
  const fileCallerLine = formatFileLinks('<-', fileCallers);
  if (fileCallerLine) header += fileCallerLine;

  // Hierarchical rendering
  const nodeWrappers = symbols.map(s => ({ node: s, children: [] as {node: CodeNode, children: any[]}[] })).sort((a,b) => a.node.startLine - b.node.startLine);
  const topLevelSymbols: typeof nodeWrappers = [];

  for (let i = 0; i < nodeWrappers.length; i++) {
    const currentWrapper = nodeWrappers[i];
    if (!currentWrapper) continue;
    let parentWrapper = null;

    // Find the tightest parent by looking backwards through the sorted list
    for (let j = i - 1; j >= 0; j--) {
        const potentialParentWrapper = nodeWrappers[j];
        if (!potentialParentWrapper) continue;
        // Check if current node is contained within the potential parent
        // For JSX elements, use a more flexible containment check
        const isContained = currentWrapper.node.startLine > potentialParentWrapper.node.startLine &&
                           currentWrapper.node.startLine < potentialParentWrapper.node.endLine;

        // Additional check for JSX elements - if they're on consecutive lines and the parent is a container element
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
    nodeLines.push(formatNode(wrapper.node, graph, idManager, rootDir, level));
    for (const childWrapper of wrapper.children) {
      processNode(childWrapper, level + 1);
    }
  };

  for (const wrapper of topLevelSymbols) {
    processNode(wrapper, 0);
  }

  return [header, ...nodeLines].join('\n');
};

/**
 * Serializes a RankedCodeGraph into the SCN text format.
 * This function is the core rendering layer of `scn-ts`.
 *
 * @param graph - The `RankedCodeGraph` produced by `repograph`.
 * @param rootDir - The root directory of the project (for reading source files).
 * @returns A string containing the full SCN map.
 */
export const serializeGraph = (graph: RankedCodeGraph, rootDir?: string): string => {
  const nodesByFile = new Map<string, CodeNode[]>(); // filePath -> nodes
  const fileNodes: CodeNode[] = [];

  for (const node of graph.nodes.values()) {
    if (node.type === 'file') {
      fileNodes.push(node);
      nodesByFile.set(node.filePath, []);
    } else {
      if (!nodesByFile.has(node.filePath)) {
        // This case can happen if repograph finds an entity but not its parent file.
        // We'll create a dummy map entry, but it won't be processed without a file node.
        nodesByFile.set(node.filePath, []);
      }
      nodesByFile.get(node.filePath)!.push(node);
    }
  }

  const sortedFileNodes = fileNodes.sort((a, b) => a.filePath.localeCompare(b.filePath));
  const idManager = new ScnIdManager(sortedFileNodes, nodesByFile);

  const scnParts = sortedFileNodes.map(fileNode => {
    const symbols = nodesByFile.get(fileNode.filePath) || [];
    // Sort symbols by line number to ensure deterministic output for hierarchical processing
    symbols.sort((a,b) => a.startLine - b.startLine);
    return serializeFile(fileNode, symbols, graph, idManager, rootDir);
  });

  return scnParts.join('\n\n');
};
````

## File: packages/scn-ts/test/ts/e2e/cli.test.ts
````typescript
import { describe, it, expect, afterEach } from 'bun:test';
import { setupTestProject, type TestProject } from '../../test.util';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { version } from '../../../package.json';

// Path to the CLI script in the main workspace
const CLI_PATH = resolve(process.cwd(), 'src/cli.ts');

describe('SCN Generation: 3. Command-Line Interface (CLI)', () => {
  let project: TestProject | undefined;

  afterEach(async () => {
    if (project) {
      await project.cleanup();
      project = undefined;
    }
  });

  it('should process glob patterns provided as arguments and print to stdout', async () => {
    project = await setupTestProject({
      'a.ts': 'export const A = 1;',
      'b.ts': 'export const B = 2;',
    });

    const proc = Bun.spawn(['bun', 'run', CLI_PATH, 'a.ts'], {
      cwd: project.projectDir,
      stderr: 'pipe',
      stdout: 'pipe',
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    const exitCode = proc.exitCode;

    expect(exitCode).toBe(0);
    expect(stdout).toContain('§ (1) a.ts');
    expect(stdout).not.toContain('b.ts');
    expect(stderr).toContain('[SCN-TS] Analyzing project...');
  });

  it('should write the output to the file specified by --output', async () => {
    project = await setupTestProject({ 'a.ts': 'export const A = 1;' });
    const outputPath = join(project.projectDir, 'output.scn');

    const proc = Bun.spawn(['bun', 'run', CLI_PATH, 'a.ts', '--output', outputPath], {
      cwd: project.projectDir,
    });

    await proc.exited;

    const outputContent = await readFile(outputPath, 'utf-8');
    expect(outputContent).toContain('§ (1) a.ts');
  });

  it('should respect the tsconfig file specified by --project', async () => {
    project = await setupTestProject({
      'Comp.tsx': 'export const C = () => <div />',
      'tsconfig.test.json': JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } }),
    });

    const proc = Bun.spawn(['bun', 'run', CLI_PATH, 'Comp.tsx', '-p', 'tsconfig.test.json'], {
      cwd: project.projectDir,
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('◇ (1.1) C');
  });

  it('should display the correct version with --version', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI_PATH, '--version']);
    const stdout = await new Response(proc.stdout).text();
    expect(stdout.trim()).toBe(version);
  });

  it('should display the help screen with --help', async () => {
    const proc = Bun.spawn(['bun', 'run', CLI_PATH, '--help']);
    const stdout = await new Response(proc.stdout).text();
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('--output <path>');
  });

  it('should exit with a non-zero code on error', async () => {
    project = await setupTestProject({}); // Empty project

    // Test with no input files specified - this should trigger the error
    const proc = Bun.spawn(['bun', 'run', CLI_PATH], {
      cwd: project.projectDir,
      stderr: 'pipe',
      stdout: 'pipe',
    });

    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    const exitCode = proc.exitCode;

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('Error: No input files specified');
  });
});
````

## File: packages/scn-ts/test/ts/e2e/config-file.test.ts
````typescript
import { describe, it, expect, afterEach } from 'bun:test';
import { setupTestProject, type TestProject } from '../../test.util';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';

// Path to the CLI script in the main workspace
const CLI_PATH = resolve(process.cwd(), 'src/cli.ts');

describe('SCN Generation: 4. Configuration (scn.config.js)', () => {
  let project: TestProject | undefined;

  afterEach(async () => {
    if (project) {
      await project.cleanup();
      project = undefined;
    }
  });

  it('should automatically find and load scn.config.js from the project root', async () => {
    project = await setupTestProject({
      'a.ts': 'const a = 1;',
      'b.ts': 'const b = 2;',
      'scn.config.js': `export default { include: ['a.ts'] };`,
    });

    const proc = Bun.spawn(['bun', 'run', CLI_PATH], {
      cwd: project.projectDir,
      stderr: 'pipe',
      stdout: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('§ (1) a.ts');
    expect(stdout).not.toContain('b.ts');
  });

  it('should correctly apply `exclude` patterns from the config', async () => {
    project = await setupTestProject({
      'a.ts': 'const a = 1;',
      'b.ignore.ts': 'const b = 2;',
      'scn.config.js': `export default { include: ['**/*.ts'], exclude: ['**/*.ignore.ts'] };`,
    });

    const proc = Bun.spawn(['bun', 'run', CLI_PATH], {
      cwd: project.projectDir,
      stderr: 'pipe',
      stdout: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('§ (1) a.ts');
    expect(stdout).not.toContain('b.ignore.ts');
  });

  it('should write to the `output` path specified in the config', async () => {
    const outputPath = 'dist/output.scn';
    project = await setupTestProject({
      'a.ts': 'const a = 1;',
      'scn.config.js': `import {mkdirSync} from 'fs'; mkdirSync('dist'); export default { include: ['a.ts'], output: '${outputPath}' };`,
    });

    const proc = Bun.spawn(['bun', 'run', CLI_PATH], {
      cwd: project.projectDir,
      stderr: 'pipe',
      stdout: 'pipe',
    });
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    const outputContent = await readFile(join(project.projectDir, outputPath), 'utf-8');
    expect(outputContent).toContain('§ (1) a.ts');
  });

  it('should override config file settings with CLI flags', async () => {
    const configOutputPath = 'config-output.scn';
    const cliOutputPath = 'cli-output.scn';

    project = await setupTestProject({
      'a.ts': 'const a = 1;',
      'b.ts': 'const b = 2;',
      'scn.config.js': `export default { include: ['a.ts'], output: '${configOutputPath}' };`,
    });

    // Override both `include` and `output`
    const proc = Bun.spawn(['bun', 'run', CLI_PATH, 'b.ts', '-o', cliOutputPath], {
      cwd: project.projectDir,
      stderr: 'pipe',
      stdout: 'pipe',
    });
    await proc.exited;

    expect(proc.exitCode).toBe(0);

    // Check that the CLI output path was used and has the correct content
    const cliOutputContent = await readFile(join(project.projectDir, cliOutputPath), 'utf-8');
    expect(cliOutputContent).toContain('§ (1) b.ts');
    expect(cliOutputContent).not.toContain('a.ts');

    // Check that the config output path was NOT created
    await expect(readFile(join(project.projectDir, configOutputPath), 'utf-8')).rejects.toThrow();
  });

  it('should respect the config file specified by --config or -c', async () => {
    project = await setupTestProject({
      'a.ts': 'const a = 1;',
      'config/my.config.js': `export default { include: ['a.ts'] };`,
    });

    const proc = Bun.spawn(['bun', 'run', CLI_PATH, '-c', 'config/my.config.js'], {
      cwd: project.projectDir,
      stderr: 'pipe',
      stdout: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain('§ (1) a.ts');
  });
});
````

## File: packages/scn-ts/test/ts/e2e/filesystem.test.ts
````typescript
import { describe, it, expect, afterEach } from 'bun:test';
import { setupTestProject, type TestProject } from '../../test.util';
import { readFile, writeFile, rm } from 'fs/promises';
import { join, resolve } from 'path';

// Path to the CLI script in the main workspace
const CLI_PATH = resolve(process.cwd(), 'src/cli.ts');

// Helper to wait for a file to contain specific content
async function waitForFileContent(filePath: string, expectedContent: string, timeout = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const content = await readFile(filePath, 'utf-8');
      if (content.includes(expectedContent)) {
        return;
      }
    } catch {
      // File might not exist yet
    }
    await new Promise(resolve => setTimeout(resolve, 100)); // Poll every 100ms
  }
  throw new Error(`Timeout waiting for "${expectedContent}" in ${filePath}`);
}

describe('SCN Generation: 5. File System & Watch Mode', () => {
  let project: TestProject | undefined;
  let watcherProc: ReturnType<typeof Bun.spawn> | undefined;

  afterEach(async () => {
    if (watcherProc) {
      watcherProc.kill();
      watcherProc = undefined;
    }
    if (project) {
      await project.cleanup();
      project = undefined;
    }
  });

  it('--watch: should perform an initial scan and re-generate when a file is modified', async () => {
    project = await setupTestProject({
      'a.ts': 'export const A = 1;',
    });
    const outputPath = join(project.projectDir, 'output.scn');

    watcherProc = Bun.spawn(['bun', 'run', CLI_PATH, '--watch', '-o', outputPath, '**/*.ts'], {
      cwd: project.projectDir,
    });

    // 1. Wait for initial generation
    await waitForFileContent(outputPath, 'A = 1');
    const initialContent = await readFile(outputPath, 'utf-8');
    expect(initialContent).toContain('§ (1) a.ts');
    expect(initialContent).toContain('◇ (1.1) A = 1');

    // 2. Modify the file
    await writeFile(join(project.projectDir, 'a.ts'), 'export const A = 42;');

    // 3. Wait for re-generation
    await waitForFileContent(outputPath, 'A = 42');
    const updatedContent = await readFile(outputPath, 'utf-8');
    expect(updatedContent).toContain('◇ (1.1) A = 42');
  });

  it('--watch: should re-generate when a new file matching the glob is added', async () => {
    project = await setupTestProject({
      'a.ts': 'export const A = 1;',
    });
    const outputPath = join(project.projectDir, 'output.scn');

    watcherProc = Bun.spawn(['bun', 'run', CLI_PATH, '--watch', '-o', outputPath, '**/*.ts'], {
      cwd: project.projectDir,
    });

    // 1. Wait for initial generation
    await waitForFileContent(outputPath, 'a.ts');

    // 2. Add a new file
    await writeFile(join(project.projectDir, 'b.ts'), 'export const B = 2;');

    // 3. Wait for re-generation to include the new file
    await waitForFileContent(outputPath, 'b.ts');
    const updatedContent = await readFile(outputPath, 'utf-8');
    expect(updatedContent).toContain('§ (1) a.ts');
    expect(updatedContent).toContain('§ (2) b.ts');
  });

  it('--watch: should re-generate when a tracked file is deleted', async () => {
    project = await setupTestProject({
      'a.ts': 'export const A = 1;',
      'b.ts': 'export const B = 2;',
    });
    const outputPath = join(project.projectDir, 'output.scn');
    const fileToDelete = join(project.projectDir, 'b.ts');

    watcherProc = Bun.spawn(['bun', 'run', CLI_PATH, '--watch', '-o', outputPath, '**/*.ts'], {
      cwd: project.projectDir,
    });

    // 1. Wait for initial generation
    await waitForFileContent(outputPath, 'b.ts');
    const initialContent = await readFile(outputPath, 'utf-8');
    expect(initialContent).toContain('b.ts');

    // 2. Delete the file
    await rm(fileToDelete);

    // 3. Wait for re-generation (b.ts should be gone)
    const start = Date.now();
    let contentHasB = true;
    while(contentHasB && Date.now() - start < 5000) {
        const content = await readFile(outputPath, 'utf-8');
        if (!content.includes('b.ts')) {
            contentHasB = false;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    expect(contentHasB).toBe(false);
    const updatedContent = await readFile(outputPath, 'utf-8');
    expect(updatedContent).toContain('a.ts');
    expect(updatedContent).not.toContain('b.ts');
  });

  it('should handle file paths with spaces correctly', async () => {
     project = await setupTestProject({
      'my component.ts': 'export const MyComponent = 1;',
    });
    const outputPath = join(project.projectDir, 'output with spaces.scn');

    const proc = Bun.spawn(
      ['bun', 'run', CLI_PATH, 'my component.ts', '-o', 'output with spaces.scn'],
      { cwd: project.projectDir }
    );
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    const outputContent = await readFile(outputPath, 'utf-8');
    expect(outputContent).toContain('§ (1) "my component.ts"');
  });
});
````

## File: packages/scn-ts/test/ts/integration/css-parsing.test.ts
````typescript
import { describe, it, expect, afterEach } from 'bun:test';
import { generateScn } from '../../../src/index';
import { setupTestProject, type TestProject } from '../../test.util';

describe('SCN Generation: 1.7 CSS Parsing & Integration', () => {
  let project: TestProject | undefined;

  afterEach(async () => {
    if (project) {
      await project.cleanup();
      project = undefined;
    }
  });

  it('should generate a ¶ CSS Rule for each selector and include intent symbols', async () => {
    project = await setupTestProject({
      'styles.css': `
        .layout-only {
          display: flex;
          position: absolute;
        }
        .text-only {
          font-weight: bold;
          text-align: center;
        }
        .appearance-only {
          background-color: blue;
          border: 1px solid red;
        }
        .all-intents {
          padding: 8px; /* layout */
          font-size: 16px; /* text */
          color: white; /* appearance */
        }
      `,
    });
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.css'] });

    // The order of intent symbols is sorted alphabetically by the serializer.
    expect(scn).toContain('  ¶ (1.1) .layout-only { 📐 }');
    expect(scn).toContain('  ¶ (1.2) .text-only { ✍ }');
    expect(scn).toContain('  ¶ (1.3) .appearance-only { 💧 }');
    expect(scn).toContain('  ¶ (1.4) .all-intents { 💧 📐 ✍ }');
  });

  it('should create links between a JSX element and CSS rules via className', async () => {
    project = await setupTestProject({
      'Button.css': `
        .btn { color: white; }
        .btn-primary { background-color: blue; }
      `,
      'Button.tsx': `
        import './Button.css';
        export function Button() {
          return <button className="btn btn-primary">Click</button>;
        }
      `,
      // tsconfig needed for repograph to process jsx/css imports
      'tsconfig.json': JSON.stringify({
        "compilerOptions": { "jsx": "react-jsx", "allowJs": true },
        "include": ["**/*.ts", "**/*.tsx"]
      }),
    });

    const scn = await generateScn({ root: project.projectDir, include: ['**/*.{ts,tsx,css}'], project: 'tsconfig.json' });

    // File sorting is alphabetical: Button.css -> 1, Button.tsx -> 2
    const tsxScn = scn.split('\n\n').find(s => s.includes('Button.tsx'));
    const cssScn = scn.split('\n\n').find(s => s.includes('Button.css'));

    expect(cssScn).toBeDefined();
    expect(tsxScn).toBeDefined();

    // Check file-level links (import relationship)
    expect(tsxScn!).toContain('§ (2) Button.tsx\n  -> (1.0)');
    expect(cssScn!).toContain('§ (1) Button.css\n  <- (2.0)');

    // Check entity-level links
    // ⛶ button (2.2) should link to both .btn (1.1) and .btn-primary (1.2)
    expect(tsxScn!).toContain('    ⛶ (2.2) button [ class:.btn .btn-primary ]\n      -> (1.1), (1.2)');

    // ¶ .btn (1.1) should link back to ⛶ button (2.2)
    expect(cssScn!).toContain('  ¶ (1.1) .btn { 💧 }\n    <- (2.2)');

    // ¶ .btn-primary (1.2) should link back to ⛶ button (2.2)
    expect(cssScn!).toContain('  ¶ (1.2) .btn-primary { 💧 }\n    <- (2.2)');
  });

  it('should create links between a JSX element and a CSS rule via id', async () => {
    project = await setupTestProject({
      'App.css': `
        #main-container { border: 1px solid black; }
      `,
      'App.tsx': `
        import './App.css';
        export function App() {
          return <div id="main-container">...</div>;
        }
      `,
      'tsconfig.json': JSON.stringify({
        "compilerOptions": { "jsx": "react-jsx", "allowJs": true },
        "include": ["**/*.ts", "**/*.tsx"]
      }),
    });

    const scn = await generateScn({ root: project.projectDir, include: ['**/*.{ts,tsx,css}'], project: 'tsconfig.json' });

    // File sorting is alphabetical: App.css -> 1, App.tsx -> 2
    const tsxScn = scn.split('\n\n').find(s => s.includes('App.tsx'));
    const cssScn = scn.split('\n\n').find(s => s.includes('App.css'));

    expect(cssScn).toBeDefined();
    expect(tsxScn).toBeDefined();

    // Check entity-level links
    // ⛶ div (2.2) should link to #main-container (1.1)
    expect(tsxScn!).toContain('    ⛶ (2.2) div [ id:#main-container ]\n      -> (1.1)');
    // ¶ #main-container (1.1) should link back to ⛶ div (2.2)
    expect(cssScn!).toContain('  ¶ (1.1) #main-container { 💧 }\n    <- (2.2)');
  });
});
````

## File: packages/scn-ts/test/ts/integration/dependency-graph.test.ts
````typescript
import { describe, it, expect, afterEach } from 'bun:test';
import { generateScn } from '../../../src/index';
import { setupTestProject, type TestProject } from '../../test.util';

describe('SCN Generation: 1.2 Inter-File Dependency Graphs', () => {
  let project: TestProject | undefined;

  afterEach(async () => {
    if (project) {
      await project.cleanup();
      project = undefined;
    }
  });

  it('should resolve and add <- annotations to entities that are used by other entities', async () => {
    project = await setupTestProject({
      'util.ts': `export function helper() {}`,
      'main.ts': `import { helper } from './util'; function main() { helper(); }`,
    });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });

    const utilScn = scn.split('\n\n').find(s => s.includes('util.ts'));
    expect(utilScn).toBeDefined();
    // main.ts is file 1, util.ts is file 2.
    // main.ts's 'main' (1.1) calls util.ts's 'helper' (2.1)
    expect(utilScn).toContain('§ (2) util.ts\n  <- (1.0)');
    expect(utilScn).toContain('  + ~ (2.1) helper()\n    <- (1.1)');
  });

  it('should add a summary of file-level dependencies and callers on the § file declaration line', async () => {
    project = await setupTestProject({
      'config.ts': `export const setting = 1;`,
      'service.ts': `import { setting } from './config'; export const value = setting;`,
      'main.ts': `import { value } from './service'; console.log(value);`,
    });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });

    // Files are sorted alphabetically: config.ts (1), main.ts (2), service.ts (3)
    // main.ts imports service.ts. service.ts imports config.ts
    expect(scn).toContain('§ (1) config.ts\n  <- (3.0)');
    expect(scn).toContain('§ (2) main.ts\n  -> (3.0)');
    expect(scn).toContain('§ (3) service.ts\n  -> (1.0)\n  <- (2.0)');
  });

  it('should correctly represent a multi-step dependency chain (A -> B -> C)', async () => {
    project = await setupTestProject({
      'c.ts': `export const C = 'c';`,
      'b.ts': `import { C } from './c'; export const B = C;`,
      'a.ts': `import { B } from './b'; function run() { console.log(B); }`,
    });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });

    // File-level links. a.ts (1), b.ts (2), c.ts (3)
    expect(scn).toContain('§ (1) a.ts\n  -> (2.0)');
    expect(scn).toContain('§ (2) b.ts\n  -> (3.0)\n  <- (1.0)');
    expect(scn).toContain('§ (3) c.ts\n  <- (2.0)');

    // Entity-level links
    const aScn = scn.split('\n\n').find(s => s.includes('a.ts'));
    const bScn = scn.split('\n\n').find(s => s.includes('b.ts'));
    const cScn = scn.split('\n\n').find(s => s.includes('c.ts'));

    expect(aScn).toContain('  ~ (1.1) run()\n    -> (2.1)'); // run() in a.ts uses B from b.ts
    expect(bScn).toContain('  + ◇ (2.1) B = C\n    -> (3.1)\n    <- (1.1)'); // B in b.ts uses C from c.ts and is used by run() from a.ts
    expect(cScn).toContain('  + ◇ (3.1) C = \'c\'\n    <- (2.1)'); // C is used by B
  });

  it('should link a dependency from the function that uses it, not just the file', async () => {
    project = await setupTestProject({
      'util.ts': `export function log() {}`,
      'main.ts': `
        import { log } from './util';
        function run() {
          log();
        }
      `,
    });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });

    const mainScn = scn.split('\n\n').find(s => s.includes('main.ts'));
    expect(mainScn).toBeDefined();
    expect(mainScn).toContain('§ (1) main.ts\n  -> (2.0)');
    expect(mainScn).toContain('  ~ (1.1) run()\n    -> (2.1)');
  });

  it('should support linking to multiple entities on one line', async () => {
     project = await setupTestProject({
      'util.ts': `
        export function helperA() {}
        export function helperB() {}
      `,
      'main.ts': `
        import { helperA, helperB } from './util';
        export function run() {
          helperA();
          helperB();
        }
      `,
    });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });
    const mainScn = scn.split('\n\n').find(s => s.includes('main.ts'));
    expect(mainScn).toBeDefined();
    // main.ts is file 1, util.ts is file 2.
    // run is 1.1, helperA is 2.1, helperB is 2.2
    expect(mainScn).toContain('§ (1) main.ts\n  -> (2.0)');
    expect(mainScn).toContain('  + ~ (1.1) run()\n    -> (2.1), (2.2)');
  });
});
````

## File: packages/scn-ts/test/ts/integration/programmatic-api.test.ts
````typescript
import { describe, it, expect, afterEach } from 'bun:test';
import {
  generateScn,
  serializeGraph,
  type RankedCodeGraph,
  type CodeNode,
  type CodeEdge as RepographEdge,
} from '../../../src/index';
import { setupTestProject, type TestProject } from '../../test.util';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// Re-define the extended edge type used internally by the serializer
type CodeEdge = Omit<RepographEdge, 'type'> & { type: RepographEdge['type'] | 'contains' | 'references' };

describe('SCN Generation: 2. Programmatic API', () => {
  let project: TestProject | undefined;

  afterEach(async () => {
    if (project) {
      await project.cleanup();
      project = undefined;
    }
  });

  describe('2.1 High-Level API (generateScn)', () => {
    it('should generate a valid SCN string given a set of include globs', async () => {
      project = await setupTestProject({
        'a.ts': `export const A = 1;`,
        'b.ts': `export const B = 2;`,
      });

      const scn = await generateScn({ root: project.projectDir, include: ['a.ts'] });
      expect(scn).toContain('§ (1) a.ts');
      expect(scn).not.toContain('b.ts');
    });

    it('should respect exclude patterns', async () => {
      project = await setupTestProject({
        'a.ts': `export const A = 1;`,
        'b.ignore.ts': `export const B = 2;`,
      });

      const scn = await generateScn({
        root: project.projectDir,
        include: ['**/*.ts'],
        exclude: ['**/*.ignore.ts'],
      });
      expect(scn).toContain('§ (1) a.ts');
      expect(scn).not.toContain('b.ignore.ts');
    });

    it('should use the project tsconfig path for better type analysis', async () => {
      project = await setupTestProject({
        'Button.tsx': `export const Button = () => <button>Click</button>;`,
        'tsconfig.json': JSON.stringify({
            "compilerOptions": { "jsx": "react-jsx" },
        }),
      });

      const scn = await generateScn({
        root: project.projectDir,
        include: ['**/*.tsx'],
        project: 'tsconfig.json',
      });

      // Correct parsing of JSX depends on tsconfig.json
      expect(scn).toContain('§ (1) Button.tsx');
      expect(scn).toContain('+ ◇ (1.2) Button');
      expect(scn).toContain('⛶ (1.3) button');
    });

    it('should return an empty string for globs that match no files', async () => {
      project = await setupTestProject({
        'a.ts': `export const A = 1;`,
      });
      const scn = await generateScn({ root: project.projectDir, include: ['**/*.js'] });
      expect(scn).toBe('');
    });

    it('should throw an error for non-existent root directory', async () => {
        const nonExistentDir = join(tmpdir(), 'scn-ts-non-existent-dir-test');
        await rm(nonExistentDir, { recursive: true, force: true }).catch(() => {});

        const promise = generateScn({ root: nonExistentDir, include: ['**/*.ts'] });

        // repograph is expected to throw when the root path does not exist.
        await expect(promise).rejects.toThrow();
    });
  });

  describe('2.2 Low-Level API (serializeGraph)', () => {
    it('should serialize a resolved graph into spec-compliant SCN string', () => {
        const fileNodeA: CodeNode = { id: 'file-a', filePath: 'a.ts', type: 'file', name: 'a.ts', startLine: 1, endLine: 1, codeSnippet: '', };
        const funcNodeA: CodeNode = { id: 'func-a', filePath: 'a.ts', type: 'function', name: 'funcA', visibility: 'public', startLine: 2, endLine: 2, codeSnippet: 'function funcA()', };
        const fileNodeB: CodeNode = { id: 'file-b', filePath: 'b.ts', type: 'file', name: 'b.ts', startLine: 1, endLine: 1, codeSnippet: '', };
        const funcNodeB: CodeNode = { id: 'func-b', filePath: 'b.ts', type: 'function', name: 'funcB', visibility: 'public', startLine: 2, endLine: 2, codeSnippet: 'function funcB()', };

        const nodes = new Map<string, CodeNode>([
            [fileNodeA.id, fileNodeA],
            [funcNodeA.id, funcNodeA],
            [fileNodeB.id, fileNodeB],
            [funcNodeB.id, funcNodeB],
        ]);

        const edges: CodeEdge[] = [
            // File A imports File B
            { fromId: 'file-a', toId: 'file-b', type: 'imports' },
            // funcA calls funcB
            { fromId: 'func-a', toId: 'func-b', type: 'references' },
        ];

        const ranks = new Map<string, number>([
            [fileNodeA.id, 0],
            [funcNodeA.id, 0],
            [fileNodeB.id, 0],
            [funcNodeB.id, 0],
        ]);
        const graph: RankedCodeGraph = { nodes, edges: edges as any, ranks };

        const scnOutput = serializeGraph(graph);

        const expectedScn = [
            '§ (1) a.ts\n  -> (2.0)\n  + ~ (1.1) funcA()\n    -> (2.1)',
            '§ (2) b.ts\n  <- (1.0)\n  + ~ (2.1) funcB()\n    <- (1.1)'
        ].join('\n\n');

        expect(scnOutput).toBe(expectedScn);
    });
  });
});
````

## File: packages/scn-ts/test/ts/unit/code-entities.test.ts
````typescript
import { describe, it, expect, afterEach } from 'bun:test';
import { generateScn } from '../../../src/index';
import { setupTestProject, type TestProject } from '../../test.util';

describe('SCN Generation: 1.3 Code Entities', () => {
  let project: TestProject | undefined;

  afterEach(async () => {
    if (project) {
      await project.cleanup();
      project = undefined;
    }
  });

  it('should represent a class with ◇', async () => {
    project = await setupTestProject({ 'test.ts': `export class MyClass {}` });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });
    expect(scn).toContain('  + ◇ (1.1) MyClass');
  });

  it('should represent a namespace with ◇', async () => {
    project = await setupTestProject({ 'test.ts': `export namespace MyNamespace {}` });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });
    expect(scn).toContain('  + ◇ (1.1) MyNamespace');
  });

  it('should represent an exported uppercase object literal (module pattern) with ◇', async () => {
    project = await setupTestProject({ 'test.ts': `export const MyModule = { key: 'value' };` });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });
    expect(scn).toContain(`  + ◇ (1.1) MyModule { key: 'value' }`);
  });

  it('should represent an interface with {}', async () => {
    project = await setupTestProject({ 'test.ts': `export interface MyInterface {}` });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });
    expect(scn).toContain('  + {} (1.1) MyInterface');
  });

  it('should represent an export function with + ~', async () => {
    project = await setupTestProject({ 'test.ts': `export function myFunc() {}` });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });
    expect(scn).toContain('  + ~ (1.1) myFunc()');
  });

  it('should represent a const arrow function with ~', async () => {
    project = await setupTestProject({ 'test.ts': `const myFunc = () => {}` });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });
    expect(scn).toContain('  ~ (1.1) myFunc()');
  });

  it('should represent a class method with ~ and a property with @', async () => {
    project = await setupTestProject({
      'test.ts': `
      export class MyClass {
        myProp: string = '';
        myMethod() {}
      }`,
    });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });
    expect(scn).toContain('    + @ (1.2) myProp');
    expect(scn).toContain('    + ~ (1.3) myMethod()');
  });

  it('should represent a top-level const with @', async () => {
    project = await setupTestProject({ 'test.ts': `const myVar = 123;` });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });
    // Note: repograph represents this as a "variable" and heuristic makes it not a container
    expect(scn).toContain('  @ (1.1) myVar = 123');
  });

  it('should correctly handle export default class', async () => {
    project = await setupTestProject({ 'test.ts': `export default class MyClass {}` });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });
    expect(scn).toContain('  + ◇ (1.1) MyClass');
  });

  it('should correctly handle export default function', async () => {
    project = await setupTestProject({ 'test.ts': `export default function myFunc() {}` });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });
    expect(scn).toContain('  + ~ (1.1) myFunc()');
  });

  it('should correctly handle export default anonymous function', async () => {
    project = await setupTestProject({ 'test.ts': `export default () => {}` });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });
    expect(scn).toContain('  + ~ (1.1) default()'); // repograph names it 'default'
  });
});
````

## File: packages/scn-ts/test/ts/unit/general-structural.test.ts
````typescript
import { describe, it, expect, afterEach } from 'bun:test';
import { generateScn } from '../../../src/index';
import { setupTestProject, type TestProject } from '../../test.util';

describe('SCN Generation: 1.1 General & Structural', () => {
  let project: TestProject | undefined;

  afterEach(async () => {
    if (project) {
      await project.cleanup();
      project = undefined;
    }
  });

  it('should generate a § file declaration with a unique ID and correct relative path', async () => {
    project = await setupTestProject({
      'a.ts': ``,
      'b.ts': ``,
    });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });

    expect(scn).toContain('§ (1) a.ts');
    expect(scn).toContain('§ (2) b.ts');
  });

  it('should assign unique, incrementing entity IDs within a file, starting from 1', async () => {
    project = await setupTestProject({
      'test.ts': `
        export function funcA() {}
        export class ClassB {}
      `,
    });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });

    expect(scn).toContain('+ ~ (1.1) funcA()');
    expect(scn).toContain('+ ◇ (1.2) ClassB');
  });

  it('should represent a side-effect import with a .0 entity ID', async () => {
    project = await setupTestProject({
      'a.ts': `import './b.ts';`,
      'b.ts': `console.log('side effect');`,
    });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });

    expect(scn).toContain('§ (1) a.ts\n  -> (2.0)');
    expect(scn).toContain('§ (2) b.ts\n  <- (1.0)');
  });

  it('should represent hierarchical code structures with correct indentation', async () => {
    project = await setupTestProject({
      'test.ts': `
        export namespace MyNamespace {
          export class MyClass {
            public myMethod() {}
          }
        }
      `,
    });
    const scn = await generateScn({
      root: project.projectDir,
      include: [`**/*.ts`],
    });

    const expected = [
      '  + ◇ (1.1) MyNamespace',
      '    + ◇ (1.2) MyClass',
      '      + ~ (1.3) myMethod()'
    ].join('\n');
    expect(scn).toContain(expected);
  });
});
````

## File: packages/scn-ts/test/ts/unit/jsx.test.ts
````typescript
import { describe, it, expect, afterEach } from 'bun:test';
import { generateScn } from '../../../src/index';
import { setupTestProject, type TestProject } from '../../test.util';

describe('SCN Generation: 1.6 JS/TS Specifics (JSX & Modules)', () => {
  let project: TestProject | undefined;

  afterEach(async () => {
    if (project) {
      await project.cleanup();
      project = undefined;
    }
  });

  it('should correctly parse a React functional component with props with ◇', async () => {
    project = await setupTestProject({
      'Button.tsx': `
        export function Button({ label, onClick }: { label: string, onClick: () => void }) {
          return <button>{label}</button>
        }
      `,
    });
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.tsx'], project: 'tsconfig.json' });
    expect(scn).toContain('+ ◇ (1.1) Button { props: { label:#, onClick:# } }');
  });

  it('should represent a JSX element with ⛶ and its attributes', async () => {
    project = await setupTestProject({
      'Component.tsx': `
        export function Component() {
          return <div id="main" className="container fluid">Hello</div>;
        }
      `,
    });
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.tsx'], project: 'tsconfig.json' });
    const divLine = scn.split('\n').find(line => line.includes('⛶ (1.2) div'));
    expect(divLine).toBeDefined();
    expect(divLine!).toContain('id:#main');
    expect(divLine!).toContain('class:.container .fluid');
  });

  it('should represent JSX hierarchy with indentation', async () => {
    project = await setupTestProject({
      'App.tsx': `
        export function App() {
          return (
            <main>
              <h1>Title</h1>
            </main>
          );
        }
      `,
    });
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.tsx'], project: 'tsconfig.json' });
    const lines = scn.split('\n');
    const mainIndex = lines.findIndex(l => l.includes('⛶ (1.2) main'));
    const h1Index = lines.findIndex(l => l.includes('⛶ (1.3) h1'));

    expect(mainIndex).toBeGreaterThan(-1);
    expect(h1Index).toBeGreaterThan(-1);
    expect(h1Index).toBe(mainIndex + 1);

    const mainIndentation = lines[mainIndex]!.match(/^\s*/)?.[0].length ?? 0;
    const h1Indentation = lines[h1Index]!.match(/^\s*/)?.[0].length ?? 0;

    expect(h1Indentation).toBeGreaterThan(mainIndentation);
  });

  it('should correctly parse various export syntaxes, including re-exports and aliases', async () => {
    project = await setupTestProject({
      'mod.ts': `
        const internal = 1;
        function b() {}
        export { internal as exported, b };
        export * from './another';
      `,
      'another.ts': 'export const c = 3;',
    });
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.ts'] });
    const modScn = scn.split('\n\n').find(s => s.includes('mod.ts'));
    // Files: another.ts (1), mod.ts (2)
    expect(modScn).toContain('§ (2) mod.ts\n  -> (1.0)');
    expect(modScn).toContain('@ (2.1) internal = 1');
    expect(modScn).toContain('~ (2.2) b()');
    // Note: The alias `exported` is not represented as a separate SCN entity.
    // The link is to the original `internal` variable.
  });

  it('should correctly parse various import syntaxes and link them from the consuming function', async () => {
    project = await setupTestProject({
      'util.ts': `
        export const val = 1;
        export function func() {}
        export default class MyClass {}
      `,
      'main.ts': `
        import MyClass, { val } from './util';
        import * as utils from './util';

        function run() {
            const x = val;
            utils.func();
            new MyClass();
        }
      `
    });
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.ts'] });
    const mainScn = scn.split('\n\n').find(s => s.includes('main.ts'));
    // Files: main.ts (1), util.ts (2)
    // Entities in util.ts: val (2.1), func (2.2), MyClass (2.3)
    // Entity in main.ts: run (1.1)
    expect(mainScn).toContain('§ (1) main.ts\n  -> (2.0)');
    expect(mainScn).toContain('  ~ (1.1) run()\n    -> (2.1), (2.2), (2.3)');
  });
});
````

## File: packages/scn-ts/test/ts/unit/qualifiers.test.ts
````typescript
import { describe, it, expect, afterEach } from 'bun:test';
import { generateScn } from '../../../src/index';
import { setupTestProject, type TestProject } from '../../test.util';

describe('SCN Generation: 1.5 Function & Method Qualifiers', () => {
  let project: TestProject | undefined;

  afterEach(async () => {
    if (project) {
      await project.cleanup();
      project = undefined;
    }
  });

  it('should prefix public members with +', async () => {
    project = await setupTestProject({
      'test.ts': `export class MyClass { public myMethod() {} }`,
    });
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.ts'] });
    expect(scn).toContain('+ ~ (1.2) myMethod()');
  });

  it('should prefix private members with -', async () => {
    project = await setupTestProject({
      'test.ts': `export class MyClass { private myMethod() {} }`,
    });
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.ts'] });
    expect(scn).toContain('- ~ (1.2) myMethod()');
  });

  it('should treat default class members as public and prefix with +', async () => {
    project = await setupTestProject({
      'test.ts': `export class MyClass { myMethod() {} }`,
    });
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.ts'] });
    expect(scn).toContain('+ ~ (1.2) myMethod()');
  });

  it('should append ... to an async function or method', async () => {
    project = await setupTestProject({
      'test.ts': `
        export async function myFunc() {}
        export class MyClass { async myMethod() {} }
      `,
    });
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.ts'] });
    expect(scn).toContain('+ ~ (1.1) myFunc() ...');
    expect(scn).toContain('+ ~ (1.3) myMethod() ...');
  });

  it('should append ! to a function that has a throw statement', async () => {
    project = await setupTestProject({
      'test.ts': `export function myFunc() { throw new Error('test'); }`,
    });
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.ts'] });
    expect(scn).toContain('+ ~ (1.1) myFunc() !');
  });

  it('should correctly handle functions that are both async and can throw', async () => {
    project = await setupTestProject({
      'test.ts': `export async function myFunc() { throw new Error('test'); }`,
    });
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.ts'] });
    expect(scn).toContain('+ ~ (1.1) myFunc() ... !');
  });

  it('should append o to a pure function (repograph heuristic)', async () => {
    // This test relies on repograph's isPure heuristic.
    // A simple function with no side effects is a good candidate.
     project = await setupTestProject({
      'test.ts': `export function add(a: number, b: number): number { return a + b; }`,
    });
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.ts'] });
    expect(scn).toContain('+ ~ (1.1) add(a: #, b: #): #number o');
  });
});
````

## File: packages/scn-ts/test/ts/unit/type-system.test.ts
````typescript
import { describe, it, expect, afterEach } from 'bun:test';
import { generateScn } from '../../../src/index';
import { setupTestProject, type TestProject } from '../../test.util';

describe('SCN Generation: 1.4 Type System Symbols', () => {
  let project: TestProject | undefined;

  afterEach(async () => {
    if (project) {
      await project.cleanup();
      project = undefined;
    }
  });

  it('should represent an enum with ☰', async () => {
    project = await setupTestProject({ 'test.ts': `export enum Color { Red, Green }` });
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.ts'] });
    expect(scn).toContain('+ ☰ (1.1) Color');
  });

  it('should represent a type alias with =:', async () => {
    project = await setupTestProject({ 'test.ts': `export type UserID = string;` });
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.ts'] });
    expect(scn).toContain('+ =: (1.1) UserID = string');
  });

  it('should represent type references in function parameters with #', async () => {
    project = await setupTestProject({ 'test.ts': `function process(id: string, value: number) {}` });
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.ts'] });
    expect(scn).toContain('~ (1.1) process(id: #, value: #)');
  });

  it('should represent a function return type with :#Type', async () => {
    project = await setupTestProject({ 'test.ts': `function isActive(): boolean {}` });
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.ts'] });
    expect(scn).toContain('~ (1.1) isActive(): #boolean');
  });

  it('should correctly represent complex types like Promise<User>', async () => {
    project = await setupTestProject({ 'test.ts': `
      interface User {}
      function getUser(): Promise<User> { return Promise.resolve({} as User); }
    `});
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.ts'] });
    expect(scn).toContain('~ (1.2) getUser(): #Promise<User>');
  });

  it('should correctly represent generic type parameters and return types', async () => {
    project = await setupTestProject({ 'test.ts': `
      function transform<T, U>(data: T[], func: (item: T) => U): U[] { return []; }
    `});
    const scn = await generateScn({ root: project.projectDir, include: ['**/*.ts'] });
    expect(scn).toContain('~ (1.1) transform(data: #, func: #): #U[]');
  });
});
````

## File: packages/scn-ts/test/test.util.ts
````typescript
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname } from 'path';

export interface TestProject {
  projectDir: string;
  cleanup: () => Promise<void>;
}

export async function setupTestProject(files: Record<string, string>): Promise<TestProject> {
  const projectDir = await mkdtemp(join(tmpdir(), 'scn-test-'));

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(projectDir, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf-8');
  }

  const cleanup = async () => {
    await rm(projectDir, { recursive: true, force: true });
  };

  return { projectDir, cleanup };
}
````

## File: packages/scn-ts/package.json
````json
{
  "name": "scn-ts",
  "version": "1.0.4",
  "description": "Generate Symbolic Context Notation (SCN) maps from your TypeScript/JavaScript codebase.",
  "author": "anton",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/your-username/scn-ts.git"
  },
  "keywords": [
    "scn",
    "typescript",
    "code-analysis",
    "context-map",
    "repograph",
    "cli"
  ],
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "scn-ts": "./dist/cli.js"
  },
  "files": [
    "dist"
  ],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "scripts": {
    "build": "tsup",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "repograph": "0.1.45"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/node": "^20.11.24",
    "tsup": "^8.0.2",
    "typescript": "^5.3.3"
  },
  "peerDependencies": {
    "typescript": "^5"
  }
}
````

## File: packages/scn-ts/tsconfig.json
````json
{
  "compilerOptions": {
    // Environment setup & latest features
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowJs": true,

    // Path mapping for local development
    // "baseUrl": ".",
    // "paths": {
    //   "repograph": ["../../src/index.ts"]
    // },

    // Bundler mode
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,

    // Best practices
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,

    // Some stricter flags (disabled by default)
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitAny": true,
    "noPropertyAccessFromIndexSignature": false
  },
  "include": ["src", "test"],
  "exclude": ["node_modules", "dist"]
}
````

## File: packages/scn-ts/tsup.config.ts
````typescript
import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: true, // Cleans the dist folder once before building.
    splitting: false,
    shims: true,
    external: ['repograph'],
  },
  {
    entry: ['src/cli.ts'],
    format: ['cjs', 'esm'],
    sourcemap: true,
    splitting: false,
    shims: true,
    external: ['repograph'],
    banner: {
      js: '#!/usr/bin/env node',
    },
    // No .d.ts files for the CLI entry point.
  },
]);
````

## File: src/pipeline/rank.ts
````typescript
import type { Ranker, CodeGraph, RankedCodeGraph } from 'repograph-core';
import { logger } from 'repograph-core';
import { execSync } from 'node:child_process';

/**
 * Creates a ranker based on Git commit history. Files changed more frequently are considered
 * more important. Requires Git to be installed and the project to be a Git repository.
 * @returns A Ranker function.
 */
export const createGitRanker = (options: { maxCommits?: number } = {}): Ranker => {
  return async (graph: CodeGraph): Promise<RankedCodeGraph> => {
    const { maxCommits = 500 } = options;
    const ranks = new Map<string, number>();

    if (graph.nodes.size === 0) {
      return { ...graph, ranks };
    }

    try {
      const command = `git log --max-count=${maxCommits} --name-only --pretty=format:`;
      const output = execSync(command, { encoding: 'utf-8' });
      const files = output.split('\n').filter(Boolean);

      const changeCounts: Record<string, number> = {};
      for (const file of files) {
        changeCounts[file] = (changeCounts[file] || 0) + 1;
      }

      const maxChanges = Math.max(...Object.values(changeCounts), 1);

      for (const [nodeId, attributes] of graph.nodes) {
        if (attributes.type === 'file') {
          const count = changeCounts[attributes.filePath] ?? 0;
          ranks.set(nodeId, count / maxChanges); // Normalize score
        } else {
          ranks.set(nodeId, 0); // Only rank files with this strategy
        }
      }
    } catch (e) {
      logger.warn('Failed to use "git" for ranking. Is git installed and is this a git repository? Defaulting to 0 for all ranks.');
      for (const [nodeId] of graph.nodes) {
        ranks.set(nodeId, 0);
      }
    }

    return { ...graph, ranks };
  };
};
````

## File: src/utils/fs.util.ts
````typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import { FileSystemError } from 'repograph-core';

export const readFile = async (filePath: string): Promise<string> => {
  try {
    const buffer = await fs.readFile(filePath);
    // A simple heuristic to filter out binary files is checking for a null byte.
    if (buffer.includes(0)) {
      throw new FileSystemError('File appears to be binary', filePath);
    }
    return buffer.toString('utf-8');
  } catch (e) {
    if (e instanceof FileSystemError) throw e;
    throw new FileSystemError('Failed to read file', filePath, e);
  }
};

export const writeFile = async (filePath: string, content: string): Promise<void> => {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  } catch (e) {
    throw new FileSystemError('Failed to write file', filePath, e);
  }
};

export const isDirectory = async (filePath: string): Promise<boolean> => {
  try {
    const stats = await fs.stat(filePath);
    return stats.isDirectory();
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') {
      return false;
    }
    throw new FileSystemError('Failed to check if path is a directory', filePath, e);
  }
};
````

## File: src/tree-sitter/languages.ts
````typescript
import * as Parser from 'web-tree-sitter';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LanguageConfig, LoadedLanguage } from 'repograph-core';
import { logger, ParserError } from 'repograph-core';

const getDirname = () => path.dirname(fileURLToPath(import.meta.url));
const loadedLanguages = new Map<string, LoadedLanguage>();
let isInitialized = false;

export const initializeParser = async (): Promise<void> => {
  if (isInitialized) return;
  await Parser.Parser.init();
  isInitialized = true;
};

const findWasmFile = async (config: LanguageConfig): Promise<string> => {
  // wasmPath is like 'tree-sitter-typescript/tree-sitter-typescript.wasm'
  const wasmFileName = path.basename(config.wasmPath);
  if (!wasmFileName) {
    throw new ParserError(`Invalid wasmPath format for ${config.name}: ${config.wasmPath}.`, config.name);
  }

  const currentDir = getDirname();

  // Path when running from dist (e.g., in a published package)
  const distWasmPath = path.resolve(currentDir, 'wasm', wasmFileName);
  if (fs.existsSync(distWasmPath)) return distWasmPath;

  // Path when running tests from src, looking in dist
  const projectDistWasmPath = path.resolve(currentDir, '../../dist/wasm', wasmFileName);
  if (fs.existsSync(projectDistWasmPath)) return projectDistWasmPath;

  // Path for development, resolving from node_modules using robust import.meta.resolve
  try {
    const [pkgName, ...rest] = config.wasmPath.split('/');
    const wasmPathInPkg = rest.join('/');
    const pkgJsonUrl = await import.meta.resolve(`${pkgName}/package.json`);
    const pkgDir = path.dirname(fileURLToPath(pkgJsonUrl));
    const resolvedWasmPath = path.join(pkgDir, wasmPathInPkg);
    if (fs.existsSync(resolvedWasmPath)) {
      return resolvedWasmPath;
    }
  } catch (e) {
    // Could not resolve, proceed to throw
  }

  throw new ParserError(`WASM file for ${config.name} not found. Looked in ${distWasmPath}, ${projectDistWasmPath}, and tried resolving from node_modules.`, config.name);
};

export const loadLanguage = async (config: LanguageConfig): Promise<LoadedLanguage> => {
  if (loadedLanguages.has(config.name)) {
    return loadedLanguages.get(config.name)!;
  }
  await initializeParser();

  try {
    const wasmPath = await findWasmFile(config);
    logger.debug(`Loading WASM for ${config.name} from: ${wasmPath}`);
    const language = await Parser.Language.load(wasmPath);
    const loadedLanguage: LoadedLanguage = { config, language };
    loadedLanguages.set(config.name, loadedLanguage);
    return loadedLanguage;
  } catch (error) {
    const message = `Failed to load Tree-sitter WASM file for ${config.name}.`;
    logger.error(message, error);
    throw new ParserError(message, config.name, error);
  }
};

export const createParserForLanguage = async (config: LanguageConfig): Promise<Parser.Parser> => {
  const { language } = await loadLanguage(config);
  const parser = new Parser.Parser();
  parser.setLanguage(language);
  return parser;
};
````

## File: src/pipeline/analyze.ts
````typescript
import { posix as path } from 'node:path';
import { URL } from 'node:url';
import Tinypool from 'tinypool';
import type { Analyzer, CodeNode, CodeEdge, FileContent, UnresolvedRelation, LanguageConfig } from 'repograph-core';
import { getLanguageConfigForFile, logger, ParserError, SymbolResolver, createLanguageImportResolvers } from 'repograph-core';
import { default as processFileInWorker } from './analyzer.worker.js';

const normalizePath = (p: string) => p.replace(/\\/g, '/');
const { getImportResolver } = createLanguageImportResolvers(path);

export const createTreeSitterAnalyzer = (options: { maxWorkers?: number } = {}): Analyzer => {
  const { maxWorkers = 1 } = options;

  return async (files: readonly FileContent[]) => {
    const nodes = new Map<string, CodeNode>();
    let unresolvedRelations: UnresolvedRelation[] = [];
    const allFilePaths = files.map(f => normalizePath(f.path));

    for (const file of files) {
      const langConfig = getLanguageConfigForFile(normalizePath(file.path));
      nodes.set(file.path, {
        id: file.path, type: 'file', name: path.basename(file.path),
        filePath: file.path, startLine: 1, endLine: file.content.split('\n').length,
        language: langConfig?.name,
      });
    }

    const filesToProcess = files.map(file => ({ file, langConfig: getLanguageConfigForFile(normalizePath(file.path)) }))
      .filter((item): item is { file: FileContent, langConfig: LanguageConfig } => !!item.langConfig);

    if (maxWorkers > 1) {
      logger.debug(`Analyzing files in parallel with ${maxWorkers} workers.`);
      const pool = new Tinypool({
        filename: new URL('analyzer.worker.js', import.meta.url).pathname,
        maxThreads: maxWorkers,
      });

      const tasks = filesToProcess.map(item => pool.run(item));
      const results = await Promise.all(tasks);

      for (const result of results) {
        if (result) {
          result.nodes.forEach((node: CodeNode) => nodes.set(node.id, node));
          unresolvedRelations.push(...result.relations);
        }
      }
    } else {
      logger.debug(`Analyzing files sequentially in the main thread.`);
      for (const item of filesToProcess) {
        try {
          const result = await processFileInWorker(item);
          if (result) {
            result.nodes.forEach(node => nodes.set(node.id, node));
            unresolvedRelations.push(...result.relations);
          }
        } catch(error) {
          logger.warn(new ParserError(`Failed to process ${item.file.path}`, item.langConfig.name, error));
        }
      }
    }

    // --- Phase 3: Resolve all relationships ---
    const edges: CodeEdge[] = [];
    const importEdges: CodeEdge[] = [];

    // Resolve imports first, as they are needed by the SymbolResolver
    for (const rel of unresolvedRelations) {
      if (rel.type === 'imports') {
        const fromNode = nodes.get(rel.fromId);
        if (!fromNode || fromNode.type !== 'file' || !fromNode.language) continue;

        const resolver = getImportResolver(fromNode.language);
        const toId = resolver(rel.fromId, rel.toName, allFilePaths);
        if (toId && nodes.has(toId)) {
          importEdges.push({ fromId: rel.fromId, toId, type: 'imports' });
        }
      }
    }

    const symbolResolver = new SymbolResolver(nodes, importEdges);

    for (const rel of unresolvedRelations) {
        if (rel.type === 'imports') continue; // Already handled

        const fromFile = rel.fromId.split('#')[0]!;
        const toNode = symbolResolver.resolve(rel.toName, fromFile);
        if (toNode && rel.fromId !== toNode.id) {
          const edgeType = (rel.type === 'reference' ? 'calls' : rel.type) as CodeEdge['type'];
          edges.push({ fromId: rel.fromId, toId: toNode.id, type: edgeType });
        }
    }

    const finalEdges = [...importEdges, ...edges];
    // Remove duplicates
    const uniqueEdges = [...new Map(finalEdges.map(e => [`${e.fromId}->${e.toId}->${e.type}`, e])).values()];

    return { nodes: Object.freeze(nodes), edges: Object.freeze(uniqueEdges) };
  };
};
````

## File: src/pipeline/discover.ts
````typescript
import { globby } from 'globby';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { FileContent, FileDiscoverer } from 'repograph-core';
import { logger, FileSystemError } from 'repograph-core';
import { isDirectory, readFile } from '../utils/fs.util';

/**
 * Creates the default file discoverer. It uses globby to find all files,
 * respecting .gitignore patterns and custom include/exclude rules.
 * @returns A FileDiscoverer function.
 */
export const createDefaultDiscoverer = (): FileDiscoverer => {
  return async ({ root, include, ignore: userIgnore, noGitignore = false }) => {
    if (!(await isDirectory(root))) {
      throw new FileSystemError('Root path is not a directory or does not exist', root);
    }

    const patterns = include && include.length > 0 ? [...include] : ['**/*'];

    const foundPaths = await globby(patterns, {
      cwd: root,
      gitignore: !noGitignore,
      ignore: [...(userIgnore || [])],
      dot: true,
      absolute: true,
      onlyFiles: true,
      followSymbolicLinks: true, // Follow symlinks to find all possible files
    });

    const relativePaths = foundPaths.map(p => path.relative(root, p).replace(/\\/g, '/'));

    // Filter out files that are duplicates via symlinks by checking their real path
    const visitedRealPaths = new Set<string>();
    const safeRelativePaths: string[] = [];

    for (const relativePath of relativePaths) {
      const fullPath = path.resolve(root, relativePath);
      try {
        const realPath = await realpath(fullPath);
        if (!visitedRealPaths.has(realPath)) {
          visitedRealPaths.add(realPath);
          safeRelativePaths.push(relativePath);
        }
      } catch (error) {
        logger.debug(`Skipping file due to symlink resolution error: ${relativePath}`);
      }
    }

    const fileContents = await Promise.all(
      safeRelativePaths.map(async (relativePath): Promise<FileContent | null> => {
        try {
          const absolutePath = path.join(root, relativePath);
          const content = await readFile(absolutePath);
          return { path: relativePath, content };
        } catch (e) {
          logger.debug(`Skipping file that could not be read: ${relativePath}`, e instanceof Error ? e.message : e);
          return null;
        }
      })
    );

    return fileContents.filter((c): c is FileContent => c !== null);
  };
};
````

## File: src/high-level.ts
````typescript
import { createDefaultDiscoverer } from './pipeline/discover';
import { createTreeSitterAnalyzer } from './pipeline/analyze';
import { createGitRanker } from './pipeline/rank';
import { createPageRanker, createMarkdownRenderer, logger, RepoGraphError, type Ranker, type RankedCodeGraph, type FileContent } from 'repograph-core';
import path from 'node:path';
import { writeFile } from './utils/fs.util';

export type RepoGraphOptions = {
  root?: string;
  output?: string;
  include?: readonly string[];
  ignore?: readonly string[];
  noGitignore?: boolean;
  rankingStrategy?: 'pagerank' | 'git-changes';
  maxWorkers?: number;
  logLevel?: 'silent' | 'error' | 'warn' | 'info' | 'debug';
  rendererOptions?: import('repograph-core').RendererOptions;
  files?: readonly FileContent[];
};

const selectRanker = (rankingStrategy: RepoGraphOptions['rankingStrategy'] = 'pagerank'): Ranker => {
  if (rankingStrategy === 'git-changes') return createGitRanker();
  if (rankingStrategy === 'pagerank') return createPageRanker();
  throw new Error(`Invalid ranking strategy: '${rankingStrategy}'. Available options are 'pagerank', 'git-changes'.`);
};

export const analyzeProject = async (options: RepoGraphOptions = {}): Promise<RankedCodeGraph> => {
  const { root, logLevel, include, ignore, noGitignore, maxWorkers, files: inputFiles } = options;

  if (logLevel) {
    logger.setLevel(logLevel);
  }

  const ranker = selectRanker(options.rankingStrategy);

  try {
    let files: readonly FileContent[];
    if (inputFiles && inputFiles.length > 0) {
      logger.info('1/3 Using provided files...');
      files = inputFiles;
    } else {
      const effectiveRoot = root || process.cwd();
      logger.info(`1/3 Discovering files in "${effectiveRoot}"...`);
      const discoverer = createDefaultDiscoverer();
      files = await discoverer({ root: path.resolve(effectiveRoot), include, ignore, noGitignore });
    }
    logger.debug(`  -> Found ${files.length} files to analyze.`);

    logger.info('2/3 Analyzing code and building graph...');
    const analyzer = createTreeSitterAnalyzer({ maxWorkers });
    const graph = await analyzer(files);
    logger.debug(`  -> Built graph with ${graph.nodes.size} nodes and ${graph.edges.length} edges.`);

    logger.info('3/3 Ranking graph nodes...');
    const rankedGraph = await ranker(graph);
    logger.debug('  -> Ranking complete.');

    return rankedGraph;
  } catch (error) {
    throw new RepoGraphError(`Failed to analyze project`, error);
  }
};

export const generateMap = async (options: RepoGraphOptions = {}): Promise<void> => {
  const finalOptions = { ...options, logLevel: options.logLevel ?? 'info' };

  const {
    root = process.cwd(),
    output = './repograph.md',
  } = finalOptions;

  try {
    const rankedGraph = await analyzeProject(finalOptions);

    logger.info('4/4 Rendering output...');
    const renderer = createMarkdownRenderer();
    const markdown = renderer(rankedGraph, finalOptions.rendererOptions);
    logger.debug('  -> Rendering complete.');

    const outputPath = path.isAbsolute(output) ? output : path.resolve(root, output);

    logger.info(`Writing report to ${path.relative(process.cwd(), outputPath)}...`);
    await writeFile(outputPath, markdown);
    logger.info('  -> Report saved.');
  } catch (error) {
    throw error;
  }
};
````

## File: tsconfig.json
````json
{
  "compilerOptions": {
    // Environment setup & latest features
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "allowJs": true,

    // Path mapping for local development
    // "baseUrl": ".",
    // "paths": {
    //   "repograph-core": ["packages/repograph-core/src/index.ts"]
    // },

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
    "noPropertyAccessFromIndexSignature": true,

    "types": ["bun-types"]
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "dist"]
}
````

## File: tsup.config.ts
````typescript
import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// A helper to get a list of wasm files from repograph-core's LANGUAGE_CONFIGS
// In a real monorepo, you might import this directly. Here, we'll hardcode it.
const getWasmFiles = () => [
  'tree-sitter-typescript/tree-sitter-typescript.wasm',
  'tree-sitter-typescript/tree-sitter-tsx.wasm',
  'tree-sitter-python/tree-sitter-python.wasm',
  'tree-sitter-java/tree-sitter-java.wasm',
  'tree-sitter-c/tree-sitter-c.wasm',
  'tree-sitter-cpp/tree-sitter-cpp.wasm',
  'tree-sitter-c-sharp/tree-sitter-c_sharp.wasm',
  'tree-sitter-css/tree-sitter-css.wasm',
  'tree-sitter-go/tree-sitter-go.wasm',
  'tree-sitter-php/tree-sitter-php.wasm',
  'tree-sitter-ruby/tree-sitter-ruby.wasm',
  'tree-sitter-rust/tree-sitter-rust.wasm',
  'tree-sitter-solidity/tree-sitter-solidity.wasm',
  'tree-sitter-swift/tree-sitter-swift.wasm',
  'tree-sitter-vue/tree-sitter-vue.wasm',
];


export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'analyzer.worker': 'src/pipeline/analyzer.worker.ts',
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
  onSuccess: async () => {
    console.log('Build successful. Copying WASM files...');
    const wasmDir = join('dist', 'wasm');
    if (!existsSync(wasmDir)) {
      mkdirSync(wasmDir, { recursive: true });
    }

    for (const wasmFile of getWasmFiles()) {
      try {
        const [pkgName, ...rest] = wasmFile.split('/');
        if (!pkgName || rest.length === 0) {
          console.warn(`[WARN] Skipping invalid wasmFile path: ${wasmFile}`);
          continue;
        }
        const wasmPathInPkg = rest.join('/');
        // Use import.meta.resolve to robustly find the package path
        const pkgJsonUrl = await import.meta.resolve(`${pkgName}/package.json`);
        const pkgDir = dirname(fileURLToPath(pkgJsonUrl));
        const srcPath = join(pkgDir, wasmPathInPkg);
        const destPath = join(wasmDir, wasmFile.split('/').pop()!);

        if (existsSync(srcPath)) {
          copyFileSync(srcPath, destPath);
          console.log(`Copied ${wasmFile.split('/').pop()} to dist/wasm/`);
        } else {
          console.warn(`[WARN] Could not find WASM file at ${srcPath}`);
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('ERR_MODULE_NOT_FOUND')) {
          console.warn(`[WARN] Could not resolve package for ${wasmFile}. Is its package installed?`);
        } else {
          console.warn(`[WARN] Error processing ${wasmFile}:`, e);
        }
      }
    }
    console.log('WASM copy complete.');
  },
});
````

## File: src/pipeline/analyzer.worker.ts
````typescript
import { createParserForLanguage } from '../tree-sitter/languages';
import type { LanguageConfig, FileContent } from 'repograph-core';
import { analyzeFileContent } from 'repograph-core';

export default async function processFileInWorker({ file, langConfig }: { file: FileContent; langConfig: LanguageConfig; }) {
  const parser = await createParserForLanguage(langConfig);
  return analyzeFileContent({ file, langConfig, parser });
}
````

## File: src/composer.ts
````typescript
import type { Analyzer, FileDiscoverer, Ranker, RepoGraphMap, Renderer } from 'repograph-core';
import { logger, RepoGraphError } from 'repograph-core';
import { writeFile } from './utils/fs.util';
import path from 'node:path';
import type { RepoGraphOptions } from './high-level';

type MapGenerator = (config: RepoGraphOptions & { root: string }) => Promise<RepoGraphMap>;

/**
 * A Higher-Order Function that takes pipeline functions as arguments and
 * returns a fully configured `generate` function for creating a codemap.
 * This is the core of RepoGraph's composability.
 *
 * @param pipeline An object containing implementations for each pipeline stage.
 * @returns An asynchronous function to generate and write the codemap.
 */
export const createMapGenerator = (pipeline: {
  readonly discover: FileDiscoverer;
  readonly analyze: Analyzer;
  readonly rank: Ranker;
  readonly render: Renderer;
}): MapGenerator => {
  if (
    !pipeline ||
    typeof pipeline.discover !== 'function' ||
    typeof pipeline.analyze !== 'function' ||
    typeof pipeline.rank !== 'function' ||
    typeof pipeline.render !== 'function'
  ) {
    throw new Error('createMapGenerator: A valid pipeline object with discover, analyze, rank, and render functions must be provided.');
  }
  return async (config) => {
    const { root, output, include, ignore, noGitignore, rendererOptions } = config;

    let stage = 'discover';
    try {
      logger.info('1/4 Discovering files...');
      const files = await pipeline.discover({ root, include, ignore, noGitignore });
      logger.debug(`  -> Found ${files.length} files to analyze.`);

      stage = 'analyze';
      logger.info('2/4 Analyzing code and building graph...');
      const graph = await pipeline.analyze(files);
      logger.debug(`  -> Built graph with ${graph.nodes.size} nodes and ${graph.edges.length} edges.`);

      stage = 'rank';
      logger.info('3/4 Ranking graph nodes...');
      const rankedGraph = await pipeline.rank(graph);
      logger.debug('  -> Ranking complete.');

      stage = 'render';
      logger.info('4/4 Rendering output...');
      const markdown = pipeline.render(rankedGraph, rendererOptions);
      logger.debug('  -> Rendering complete.');

      if (output) {
        const outputPath = path.isAbsolute(output) ? output : path.resolve(root, output);
        stage = 'write';
        logger.info(`Writing report to ${path.relative(process.cwd(), outputPath)}...`);
        await writeFile(outputPath, markdown);
        logger.info('  -> Report saved.');
      }

      return { graph: rankedGraph, markdown };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stageErrorMessage = stage === 'write' ? `Failed to write output file` : `Error in ${stage} stage`;
      throw new RepoGraphError(`${stageErrorMessage}: ${message}`, error);
    }
  };
};
````

## File: src/index.ts
````typescript
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
````

## File: package.json
````json
{
  "name": "repograph",
  "version": "0.1.45",
  "description": "Generate rich, semantic, and interactive codemaps with a functional, composable API for Node.js.",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "repograph": "./dist/index.js"
  },
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
    "@types/js-yaml": "^4.0.9",
    "globby": "^14.1.0",
    "repograph-core": "0.1.20",
    "tinypool": "^0.8.2",
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
    "tree-sitter-swift": "^0.7.1",
    "tree-sitter-typescript": "^0.23.2",
    "tree-sitter-vue": "^0.2.1",
    "web-tree-sitter": "^0.25.6"
  },
  "devDependencies": {
    "@types/node": "^20.12.12",
    "bun-types": "latest",
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
    "repo-analysis",
    "ai-context",
    "cli"
  ],
  "author": "RelayCoder <you@example.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/relaycoder/repograph.git",
    "directory": "packages/repograph"
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











# 9948 Directory Structure
```
src/
  pipeline/
    analyze.ts
    analyzer.worker.ts
    browser-analyze.ts
    browser-rank.ts
    discover.ts
    rank.ts
    render.ts
  tree-sitter/
    browser-languages.ts
    language-config.ts
    languages.ts
    queries.ts
  types/
    graphology-pagerank.d.ts
  utils/
    error.util.ts
    fs.util.ts
    logger.util.ts
  browser-high-level.ts
  browser.ts
  composer.ts
  high-level.ts
  index.ts
  types.ts
package.json
tsconfig.json
tsup.config.ts
```

# Files

## File: src/types/graphology-pagerank.d.ts
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

## File: src/utils/error.util.ts
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

## File: src/pipeline/browser-rank.ts
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

/**
 * Git ranker is not available in browser environment.
 * This function throws an error if called.
 */
export const createGitRanker = (): Ranker => {
  return async (): Promise<RankedCodeGraph> => {
    throw new Error('GitRanker is not supported in the browser environment. Use PageRank instead.');
  };
};
````

## File: src/tree-sitter/browser-languages.ts
````typescript
import * as Parser from 'web-tree-sitter';
import { LANGUAGE_CONFIGS, type LanguageConfig, type LoadedLanguage } from './language-config';
import { logger } from '../utils/logger.util';
import { ParserError } from '../utils/error.util';

export interface ParserInitializationOptions {
  /**
   * For browser environments, sets the base URL from which to load Tree-sitter WASM files.
   * For example, if your WASM files are in `public/wasm`, you would set this to `/wasm/`.
   */
  wasmBaseUrl?: string;
}

let wasmBaseUrl: string | null = null;
let isInitialized = false;
const loadedLanguages = new Map<string, LoadedLanguage>();

/**
 * Initializes the Tree-sitter parser system.
 * This must be called before any other parser functions.
 * This function is idempotent.
 */
export const initializeParser = async (options: ParserInitializationOptions = {}): Promise<void> => {
  if (isInitialized) {
    return;
  }
  if (options.wasmBaseUrl) wasmBaseUrl = options.wasmBaseUrl;

  // Configure Tree-sitter to locate the main WASM file
  await Parser.Parser.init({});
  isInitialized = true;
};

/**
 * Loads a specific language grammar.
 * @param config The language configuration to load
 * @returns A LoadedLanguage object containing the config and language
 */
export const loadLanguage = async (config: LanguageConfig): Promise<LoadedLanguage> => {
  if (loadedLanguages.has(config.name)) {
    return loadedLanguages.get(config.name)!;
  }

  await initializeParser();

  try {
    if (!wasmBaseUrl) {
      throw new ParserError(
        'In a browser environment, you must call initializeParser({ wasmBaseUrl: "..." }) before loading languages.',
        config.name
      );
    }

    const wasmFileName = config.wasmPath.split('/').pop();
    if (!wasmFileName) {
      throw new ParserError(`Invalid wasmPath for ${config.name}: ${config.wasmPath}`, config.name);
    }

    const baseUrl = wasmBaseUrl.endsWith('/') ? wasmBaseUrl : `${wasmBaseUrl}/`;
    const finalWasmPath = new URL(wasmFileName, new URL(baseUrl, window.location.origin)).href;

    logger.debug(`Loading WASM from: ${finalWasmPath}`);
    console.log(`[DEBUG] wasmBaseUrl: ${wasmBaseUrl}`);
    console.log(`[DEBUG] wasmFileName: ${wasmFileName}`);
    console.log(`[DEBUG] baseUrl: ${baseUrl}`);
    console.log(`[DEBUG] finalWasmPath: ${finalWasmPath}`);

    // Fetch the WASM file to check if it's accessible
    const response = await fetch(finalWasmPath);
    if (!response.ok) {
      throw new Error(`Failed to fetch WASM file: ${response.status} ${response.statusText}`);
    }
    const wasmBytes = await response.arrayBuffer();
    console.log(`[DEBUG] WASM file loaded, size: ${wasmBytes.byteLength} bytes`);

    const language = await Parser.Language.load(new Uint8Array(wasmBytes));

    const loadedLanguage: LoadedLanguage = {
      config,
      language
    };

    loadedLanguages.set(config.name, loadedLanguage);
    return loadedLanguage;
  } catch (error) {
    const message = `Failed to load Tree-sitter WASM file for ${config.name}. Please ensure WASM files are available.`;
    logger.error(message, error);
    throw new ParserError(message, config.name, error);
  }
};

/**
 * Creates a parser instance for a specific language.
 * @param config The language configuration
 * @returns A parser instance configured for the specified language
 */
export const createParserForLanguage = async (config: LanguageConfig): Promise<Parser.Parser> => {
  const loadedLanguage = await loadLanguage(config);
  const parser = new Parser.Parser();
  parser.setLanguage(loadedLanguage.language);
  return parser;
};

/**
 * Gets all loaded languages.
 * @returns A map of language names to LoadedLanguage objects
 */
export const getLoadedLanguages = (): Map<string, LoadedLanguage> => {
  return new Map(loadedLanguages);
};

/**
 * Preloads all supported languages.
 * This can be called to eagerly load all language parsers.
 */
export const preloadAllLanguages = async (): Promise<void> => {
  await Promise.all(LANGUAGE_CONFIGS.map(config => loadLanguage(config)));
};

// Legacy function for backward compatibility
export const getParser = async (): Promise<Parser.Parser> => {
  const tsConfig = LANGUAGE_CONFIGS.find(config => config.name === 'typescript');
  if (!tsConfig) {
    throw new Error('TypeScript configuration not found');
  }
  return createParserForLanguage(tsConfig);
};
````

## File: src/tree-sitter/queries.ts
````typescript
import { LANGUAGE_CONFIGS, getLanguageConfigForFile, type LanguageConfig } from './language-config';

/**
 * Tree-sitter query for TypeScript and JavaScript to capture key symbols.
 * This query is designed to find definitions of classes, functions, interfaces,
 * and import statements to build the code graph.
 *
 * @deprecated Use getQueryForLanguage() instead
 */
export const TS_QUERY = `
(import_statement
  source: (string) @import.source) @import.statement

(class_declaration) @class.definition
(export_statement declaration: (class_declaration)) @class.definition

(function_declaration) @function.definition
(export_statement declaration: (function_declaration)) @function.definition

(variable_declarator value: (arrow_function)) @function.arrow.definition
(public_field_definition value: (arrow_function)) @function.arrow.definition
(export_statement declaration: (lexical_declaration (variable_declarator value: (arrow_function)))) @function.arrow.definition

(interface_declaration) @interface.definition
(export_statement declaration: (interface_declaration)) @interface.definition

(type_alias_declaration) @type.definition
(export_statement declaration: (type_alias_declaration)) @type.definition

(method_definition) @method.definition
(public_field_definition) @field.definition

(call_expression
  function: (identifier) @function.call)
`;

/**
 * Get the Tree-sitter query for a specific language configuration.
 * @param config The language configuration
 * @returns The query string for the language
 */
export function getQueryForLanguage(config: LanguageConfig): string {
  return config.query.trim();
}

/**
 * Get the Tree-sitter query for a file based on its extension.
 * @param filePath The file path
 * @returns The query string for the file's language, or null if not supported
 */
export function getQueryForFile(filePath: string): string | null {
  const config = getLanguageConfigForFile(filePath);
  return config ? getQueryForLanguage(config) : null;
}

/**
 * Get all supported language configurations.
 * @returns Array of all language configurations
 */
export function getAllLanguageConfigs(): LanguageConfig[] {
  return [...LANGUAGE_CONFIGS];
}
````

## File: src/utils/fs.util.ts
````typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import { FileSystemError } from './error.util';

export const readFile = async (filePath: string): Promise<string> => {
  try {
    const buffer = await fs.readFile(filePath);
    // A simple heuristic to filter out binary files is checking for a null byte.
    if (buffer.includes(0)) {
      throw new FileSystemError('File appears to be binary', filePath);
    }
    return buffer.toString('utf-8');
  } catch (e) {
    if (e instanceof FileSystemError) {
      throw e;
    }
    throw new FileSystemError('Failed to read file', filePath, e);
  }
};

export const writeFile = async (filePath: string, content: string): Promise<void> => {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  } catch (e) {
    throw new FileSystemError('Failed to write file', filePath, e);
  }
};

export const isDirectory = async (filePath: string): Promise<boolean> => {
  try {
    const stats = await fs.stat(filePath);
    return stats.isDirectory();
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') {
      return false;
    }
    throw new FileSystemError('Failed to check if path is a directory', filePath, e);
  }
};
````

## File: src/browser-high-level.ts
````typescript
// Browser-compatible version of high-level.ts
import { createTreeSitterAnalyzer } from './pipeline/browser-analyze';
import { createPageRanker } from './pipeline/browser-rank';
import type { RepoGraphOptions, Ranker, RankedCodeGraph, FileContent } from './types';
import { logger } from './utils/logger.util';
import { RepoGraphError } from './utils/error.util';

const selectRanker = (rankingStrategy: RepoGraphOptions['rankingStrategy'] = 'pagerank'): Ranker => {
  if (rankingStrategy === 'pagerank') {
    return createPageRanker();
  }
  // Git ranker is not available in browser
  throw new Error(`Invalid ranking strategy: '${rankingStrategy}'. Only 'pagerank' is available in browser environment.`);
};

/**
 * A mid-level API for programmatically generating and receiving the code graph
 * without rendering it to a file. Ideal for integration with other tools.
 * Browser-compatible version that requires files to be provided.
 *
 * @param options The configuration object for generating the map.
 * @returns The generated `RankedCodeGraph`.
 */
export const analyzeProject = async (options: RepoGraphOptions = {}): Promise<RankedCodeGraph> => {
  const { logLevel, maxWorkers, files: inputFiles } = options;

  if (logLevel) {
    logger.setLevel(logLevel);
  }

  // Validate options before entering the main try...catch block to provide clear errors.
  const ranker = selectRanker(options.rankingStrategy);

  try {
    let files: readonly FileContent[];
    if (inputFiles && inputFiles.length > 0) {
      logger.info('1/3 Using provided files...');
      files = inputFiles;
    } else {
      throw new RepoGraphError('File discovery is not supported in the browser. Please provide the `files` option with file content.');
    }
    logger.debug(`  -> Found ${files.length} files to analyze.`);

    logger.info('2/3 Analyzing code and building graph...');
    const analyzer = createTreeSitterAnalyzer({ maxWorkers });
    const graph = await analyzer(files);
    logger.debug(`  -> Built graph with ${graph.nodes.size} nodes and ${graph.edges.length} edges.`);

    logger.info('3/3 Ranking graph nodes...');
    const rankedGraph = await ranker(graph);
    logger.debug('  -> Ranking complete.');

    return rankedGraph;
  } catch (error) {
    throw new RepoGraphError(`Failed to analyze project`, error);
  }
};
````

## File: src/pipeline/browser-analyze.ts
````typescript
// Browser-compatible version of analyze.ts
// Removes worker functionality and Node.js dependencies

import type { Analyzer, FileContent, CodeGraph, CodeNode, CodeEdge } from '../types';
import { createParserForLanguage } from '../tree-sitter/browser-languages';
import { LANGUAGE_CONFIGS } from '../tree-sitter/language-config';
import { getQueryForLanguage } from '../tree-sitter/queries';
import { logger } from '../utils/logger.util';
import { ParserError } from '../utils/error.util';

// Browser path utilities (simplified)
const browserPath = {
  extname: (filePath: string): string => {
    const lastDot = filePath.lastIndexOf('.');
    return lastDot === -1 ? '' : filePath.slice(lastDot);
  },
  basename: (filePath: string, ext?: string): string => {
    const name = filePath.split('/').pop() || filePath;
    return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
  }
};

interface AnalyzerOptions {
  maxWorkers?: number; // Ignored in browser version
}

/**
 * Creates a Tree-sitter based analyzer that processes files and builds a code graph.
 * Browser version - runs analysis in main thread only.
 */
export const createTreeSitterAnalyzer = (_options: AnalyzerOptions = {}): Analyzer => {
  return async (files: readonly FileContent[]): Promise<CodeGraph> => {
    logger.debug(`Starting analysis of ${files.length} files (browser mode - single threaded)`);

    const nodes = new Map<string, CodeNode>();
    const edges: CodeEdge[] = [];

    // Phase 1: Add all files as nodes
    for (const file of files) {
      const ext = browserPath.extname(file.path);
      const config = LANGUAGE_CONFIGS.find(c => c.extensions.includes(ext));

      const fileNode = {
        id: file.path,
        type: 'file' as const,
        name: browserPath.basename(file.path),
        filePath: file.path,
        startLine: 1,
        endLine: file.content.split('\n').length,
        language: config?.name,
      };

      nodes.set(file.path, fileNode);
      console.debug(`[DEBUG] Added file node: ${file.path}, type: ${fileNode.type}`);
    }

    // Phase 2: Process files sequentially in browser to extract symbols
    for (const file of files) {
      try {
        await processFile(file, nodes, edges);
      } catch (error) {
        logger.warn(`Failed to process file ${file.path}:`, error instanceof Error ? error.message : error);
      }
    }

    logger.debug(`Analysis complete: ${nodes.size} nodes, ${edges.length} edges`);
    return { nodes, edges };
  };
};

async function processFile(
  file: FileContent,
  nodes: Map<string, CodeNode>,
  edges: CodeEdge[]
): Promise<void> {
  const ext = browserPath.extname(file.path);
  const config = LANGUAGE_CONFIGS.find(c => c.extensions.includes(ext));

  if (!config) {
    logger.debug(`No language config found for extension: ${ext}`);
    return;
  }

  try {
    const parser = await createParserForLanguage(config);
    const tree = parser.parse(file.content);
    const queryString = getQueryForLanguage(config);

    if (!queryString) {
      logger.debug(`No query available for ${config.name}`);
      return;
    }

    try {
      const loadedLanguage = await import('../tree-sitter/browser-languages').then(m => m.loadLanguage(config));
      const Query = (await import('web-tree-sitter')).Query;
      const query = new Query(loadedLanguage.language, queryString);
      const captures = query.captures(tree!.rootNode);

      for (const capture of captures) {
        processCapture(capture, file, nodes, edges);
      }
    } catch (error) {
      logger.debug(`Query processing failed in ${file.path}:`, error);
    }
  } catch (error) {
    throw new ParserError(`Failed to analyze file ${file.path}`, config.name, error);
  }
}

function processCapture(
  capture: any,
  file: FileContent,
  nodes: Map<string, CodeNode>,
  edges: CodeEdge[]
): void {
  const { node, name: captureName } = capture;

  // Create node ID
  const nodeId = `${file.path}:${node.startPosition.row}:${node.startPosition.column}`;

  // Determine node type and visibility
  let nodeType: CodeNode['type'] = 'variable';
  let visibility: CodeNode['visibility'] = 'public';

  if (captureName.includes('function')) {
    nodeType = 'function';
  } else if (captureName.includes('class')) {
    nodeType = 'class';
  } else if (captureName.includes('interface')) {
    nodeType = 'interface';
  }

  // Create or update node
  if (!nodes.has(nodeId)) {
    const codeNode: CodeNode = {
      id: nodeId,
      name: node.text.split('\n')[0].trim().slice(0, 100), // First line, truncated
      type: nodeType,
      visibility,
      filePath: file.path,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      codeSnippet: node.text.slice(0, 200), // Truncated snippet
    };

    nodes.set(nodeId, codeNode);
  }

  // Handle relationships (simplified)
  if (captureName.includes('import') && node.text.includes('from')) {
    // Create import edge
    const importPath = extractImportPath(node.text);
    if (importPath) {
      edges.push({
        fromId: nodeId,
        toId: `${importPath}:0:0`, // Simplified target
        type: 'imports',
      });
    }
  }
}

function extractImportPath(importText: string): string | null {
  const match = importText.match(/from\s+['"]([^'"]+)['"]/);
  return match?.[1] ?? null;
}
````

## File: src/utils/logger.util.ts
````typescript
export const LogLevels = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
} as const;

export type LogLevel = keyof typeof LogLevels;

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

  logFunctions[level](...args);
};

export type Logger = {
  readonly error: (...args: any[]) => void;
  readonly warn: (...args: any[]) => void;
  readonly info: (...args: any[]) => void;
  readonly debug: (...args: any[]) => void;
  readonly setLevel: (level: LogLevel) => void;
  readonly getLevel: () => LogLevel;
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
  });
};

export const logger = createLogger();
````

## File: src/browser.ts
````typescript
// Browser-compatible entry point for repograph
// Only exports functions that work in the browser environment

// High-level API - analyzeProject works in browser when files are provided
export { analyzeProject } from './browser-high-level';
export { initializeParser } from './tree-sitter/browser-languages';

// Browser-compatible pipeline components only
export { createTreeSitterAnalyzer } from './pipeline/browser-analyze';
export { createPageRanker } from './pipeline/browser-rank';
export { createMarkdownRenderer } from './pipeline/render';

// Logger utilities
export { logger } from './utils/logger.util';
export type { LogLevel, Logger } from './utils/logger.util';
export type { ParserInitializationOptions } from './tree-sitter/browser-languages';

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
````

## File: tsconfig.json
````json
{
  "compilerOptions": {
    // Environment setup & latest features
    "lib": ["ESNext", "DOM"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "jsx": "react-jsx",
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

    // Some stricter flags (disabled by default)
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitAny": true,
    "noPropertyAccessFromIndexSignature": true,

    // Include bun types
    "types": ["bun-types"]
  },
  "include": [
    "src/**/*",
    "test/**/*",
    "web-demo/src/**/*",
    "bun.d.ts"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "docs",
    ".relay",
    ".relaycode"
  ]
}
````

## File: src/pipeline/discover.ts
````typescript
import { globby } from 'globby';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { FileContent, FileDiscoverer } from '../types';
import { isDirectory, readFile } from '../utils/fs.util';
import { FileSystemError } from '../utils/error.util';
import { logger } from '../utils/logger.util';

/**
 * Creates the default file discoverer. It uses globby to find all files,
 * respecting .gitignore patterns and custom include/exclude rules.
 * @returns A FileDiscoverer function.
 */
export const createDefaultDiscoverer = (): FileDiscoverer => {
  return async ({ root, include, ignore: userIgnore, noGitignore = false }) => {
    try {
      if (!(await isDirectory(root))) {
        throw new FileSystemError('Root path is not a directory or does not exist', root);
      }
    } catch (e) {
      throw e;
    }
    const patterns = include && include.length > 0 ? [...include] : ['**/*'];

    // Manually build the ignore list to replicate the old logic without the `ignore` package.
    const ignorePatterns = [
      '**/node_modules/**',
      '**/.git/**',
      '.gitignore', // Always ignore the gitignore file itself
    ];

    if (userIgnore && userIgnore.length > 0) {
      ignorePatterns.push(...userIgnore);
    }

    if (!noGitignore) {
      try {
        const gitignoreContent = await readFile(path.join(root, '.gitignore'));
        const gitignoreLines = gitignoreContent
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0 && !line.startsWith('#'));
        ignorePatterns.push(...gitignoreLines);
      } catch {
        // .gitignore is optional, so we can ignore errors here.
      }
    }

    // Use globby to find all files, passing our manually constructed ignore list.
    // We set `gitignore: false` because we are handling it ourselves.
    const foundPaths = await globby(patterns, {
      cwd: root,
      gitignore: false, // We handle gitignore patterns manually
      ignore: ignorePatterns,
      dot: true,
      absolute: true,
      followSymbolicLinks: true,
      onlyFiles: true,
    });

    const relativePaths = foundPaths.map(p => path.relative(root, p).replace(/\\/g, '/'));

    // Filter out files that are duplicates via symlinks
    const visitedRealPaths = new Set<string>();
    const safeRelativePaths: string[] = [];

    for (const relativePath of relativePaths) {
      const fullPath = path.resolve(root, relativePath);
      try {
        const realPath = await realpath(fullPath);
        if (!visitedRealPaths.has(realPath)) {
          visitedRealPaths.add(realPath);
          safeRelativePaths.push(relativePath);
        }
      } catch (error) {
        // If we can't resolve the real path, skip this file
        logger.debug(`Skipping file due to symlink resolution error: ${relativePath}`);
      }
    }

    // The `ignore` option in globby should have already done the filtering.
    const filteredPaths = safeRelativePaths;

    const fileContents = await Promise.all(
      filteredPaths.map(async (relativePath): Promise<FileContent | null> => {
        try {
          const absolutePath = path.join(root, relativePath);
          const content = await readFile(absolutePath);
          return { path: relativePath, content };
        } catch (e) {
          logger.debug(`Skipping file that could not be read: ${relativePath}`, e instanceof Error ? e.message : e);
          return null;
        }
      })
    );

    return fileContents.filter((c): c is FileContent => c !== null);
  };
};
````

## File: src/pipeline/render.ts
````typescript
import type { Renderer, RankedCodeGraph, RendererOptions, CodeEdge, CodeNode } from '../types';

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
    console.debug(`[DEBUG] Total nodes: ${nodes.size}, File nodes: ${fileNodes.length}, Node types:`,
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

## File: src/tree-sitter/languages.ts
````typescript
import * as Parser from 'web-tree-sitter';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGE_CONFIGS, type LanguageConfig, type LoadedLanguage } from './language-config';
import { logger } from '../utils/logger.util';
import { ParserError } from '../utils/error.util';

// Helper to get the correct path in different environments
const getDirname = () => path.dirname(fileURLToPath(import.meta.url));

const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';

export interface ParserInitializationOptions {
  /**
   * For browser environments, sets the base URL from which to load Tree-sitter WASM files.
   * For example, if your WASM files are in `public/wasm`, you would set this to `/wasm/`.
   * This option is ignored in Node.js environments.
   */
  wasmBaseUrl?: string;
}

let wasmBaseUrl: string | null = null;
let isInitialized = false;
const loadedLanguages = new Map<string, LoadedLanguage>();

/**
 * Initializes the Tree-sitter parser system.
 * This must be called before any other parser functions.
 * This function is idempotent.
 */
export const initializeParser = async (options: ParserInitializationOptions = {}): Promise<void> => {
  if (isInitialized) {
    return;
  }
  if (isBrowser && options.wasmBaseUrl) wasmBaseUrl = options.wasmBaseUrl;

  await Parser.Parser.init();
  isInitialized = true;
};

/**
 * Loads a specific language grammar.
 * @param config The language configuration to load
 * @returns A LoadedLanguage object containing the config and language
 */
export const loadLanguage = async (config: LanguageConfig): Promise<LoadedLanguage> => {
  if (loadedLanguages.has(config.name)) {
    return loadedLanguages.get(config.name)!;
  }

  await initializeParser();

  try {
    let finalWasmPath: string;

    if (isBrowser) {
      if (!wasmBaseUrl) {
        throw new ParserError(
          'In a browser environment, you must call initializeParser({ wasmBaseUrl: "..." }) before loading languages.',
          config.name
        );
      }
      const wasmFileName = config.wasmPath.split('/')[1];
      if (!wasmFileName) {
        throw new ParserError(`Invalid wasmPath for ${config.name}: ${config.wasmPath}`, config.name);
      }
      const baseUrl = wasmBaseUrl.endsWith('/') ? wasmBaseUrl : `${wasmBaseUrl}/`;
      finalWasmPath = new URL(baseUrl + wasmFileName, window.location.href).href;
    } else {
      // Node.js logic
      const wasmFileName = config.wasmPath.split('/')[1];
      if (!wasmFileName) {
        throw new ParserError(`Invalid wasmPath format for ${config.name}: ${config.wasmPath}. Expected 'package/file.wasm'.`, config.name);
      }
      // Try multiple possible paths for WASM files
      const currentDir = getDirname();
      const distWasmPath = path.resolve(currentDir, '..', 'wasm', wasmFileName);
      const nodeModulesWasmPath = path.resolve(currentDir, '..', '..', 'node_modules', config.wasmPath);
      // For published packages, the WASM files should be in the same dist directory
      const publishedWasmPath = path.resolve(currentDir, 'wasm', wasmFileName);
      // When running from source, look in the project's dist/wasm directory
      const projectDistWasmPath = path.resolve(currentDir, '..', '..', 'dist', 'wasm', wasmFileName);

      logger.debug(`Trying WASM paths: dist=${distWasmPath}, published=${publishedWasmPath}, projectDist=${projectDistWasmPath}, nodeModules=${nodeModulesWasmPath}`);

      const fs = await import('node:fs');
      if (fs.existsSync(distWasmPath)) {
        finalWasmPath = distWasmPath;
      } else if (fs.existsSync(publishedWasmPath)) {
        finalWasmPath = publishedWasmPath;
      } else if (fs.existsSync(projectDistWasmPath)) {
        finalWasmPath = projectDistWasmPath;
      } else if (fs.existsSync(nodeModulesWasmPath)) {
        finalWasmPath = nodeModulesWasmPath;
      } else {
        throw new Error(`WASM file not found at any of: ${distWasmPath}, ${publishedWasmPath}, ${projectDistWasmPath}, ${nodeModulesWasmPath}`);
      }
    }

    logger.debug(`Loading WASM from: ${finalWasmPath}`);
    const language = await Parser.Language.load(finalWasmPath);

    const loadedLanguage: LoadedLanguage = {
      config,
      language
    };

    loadedLanguages.set(config.name, loadedLanguage);
    return loadedLanguage;
  } catch (error) {
    const message = `Failed to load Tree-sitter WASM file for ${config.name}. Please ensure '${config.wasmPath.split('/')[0]}' is installed.`;
    logger.error(message, error);
    throw new ParserError(message, config.name, error);
  }
};

/**
 * Creates a parser instance for a specific language.
 * @param config The language configuration
 * @returns A parser instance configured for the specified language
 */
export const createParserForLanguage = async (config: LanguageConfig): Promise<Parser.Parser> => {
  const loadedLanguage = await loadLanguage(config);
  const parser = new Parser.Parser();
  parser.setLanguage(loadedLanguage.language);
  return parser;
};

/**
 * Gets all loaded languages.
 * @returns A map of language names to LoadedLanguage objects
 */
export const getLoadedLanguages = (): Map<string, LoadedLanguage> => {
  return new Map(loadedLanguages);
};

/**
 * Preloads all supported languages.
 * This can be called to eagerly load all language parsers.
 */
export const preloadAllLanguages = async (): Promise<void> => {
  await Promise.all(LANGUAGE_CONFIGS.map(config => loadLanguage(config)));
};


// Legacy function for backward compatibility
export const getParser = async (): Promise<Parser.Parser> => {
  const tsConfig = LANGUAGE_CONFIGS.find(config => config.name === 'typescript');
  if (!tsConfig) {
    throw new Error('TypeScript configuration not found');
  }
  return createParserForLanguage(tsConfig);
};
````

## File: tsup.config.ts
````typescript
import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    browser: 'src/browser.ts',
    'analyzer.worker': 'src/pipeline/analyzer.worker.ts',
  },
  format: ['esm', 'cjs'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false, // Disable splitting for CJS compatibility
  treeshake: true,
  minify: false,
  outDir: 'dist',
  onSuccess: async () => {
    // Copy WASM files to dist folder
    const wasmDir = join('dist', 'wasm');
    if (!existsSync(wasmDir)) {
      mkdirSync(wasmDir, { recursive: true });
    }

    const wasmFiles = [
      'tree-sitter-typescript/tree-sitter-typescript.wasm',
      'tree-sitter-typescript/tree-sitter-tsx.wasm',
      'tree-sitter-javascript/tree-sitter-javascript.wasm',
      'tree-sitter-python/tree-sitter-python.wasm',
      'tree-sitter-java/tree-sitter-java.wasm',
      'tree-sitter-c/tree-sitter-c.wasm',
      'tree-sitter-cpp/tree-sitter-cpp.wasm',
      'tree-sitter-c-sharp/tree-sitter-c-sharp.wasm',
      'tree-sitter-css/tree-sitter-css.wasm',
      'tree-sitter-go/tree-sitter-go.wasm',
      'tree-sitter-php/tree-sitter-php.wasm',
      'tree-sitter-ruby/tree-sitter-ruby.wasm',
      'tree-sitter-rust/tree-sitter-rust.wasm',
      'tree-sitter-solidity/tree-sitter-solidity.wasm',
      'tree-sitter-swift/tree-sitter-swift.wasm',
      'tree-sitter-vue/tree-sitter-vue.wasm',
    ];

    for (const wasmFile of wasmFiles) {
      const srcPath = join('node_modules', wasmFile);
      const wasmFileName = wasmFile.split('/')[1];
      if (!wasmFileName) {
        console.warn(`Skipping invalid wasmFile path: ${wasmFile}`);
        continue;
      }
      const destPath = join('dist', 'wasm', wasmFileName);

      if (existsSync(srcPath)) {
        copyFileSync(srcPath, destPath);
        console.log(`Copied ${wasmFileName} to dist/wasm/`);
      }
    }
  },
});
````

## File: src/pipeline/analyzer.worker.ts
````typescript
import type { Node as TSNode, QueryCapture as TSMatch } from 'web-tree-sitter';
import { createParserForLanguage } from '../tree-sitter/languages';
import type { LanguageConfig } from '../tree-sitter/language-config';
import type { CodeNode, CodeNodeType, CodeNodeVisibility, FileContent, UnresolvedRelation } from '../types';

// --- UTILITY FUNCTIONS (mirrored from original analyze.ts) ---

const getNodeText = (node: TSNode, content: string): string => content.slice(node.startIndex, node.endIndex);
const getLineFromIndex = (content: string, index: number): number => content.substring(0, index).split('\n').length;

const extractCodeSnippet = (symbolType: CodeNodeType, node: TSNode): string => {
  const text = node.text;
  switch (symbolType) {
    case 'variable': case 'constant': case 'property': {
      const assignmentMatch = text.match(/=\s*(.+)$/s);
      return (assignmentMatch?.[1] ?? text).trim();
    }
    case 'field': {
      const colonIndex = text.indexOf(':');
      if (colonIndex !== -1) return text.substring(colonIndex).trim();
      const equalsIndex = text.indexOf('=');
      if (equalsIndex !== -1) return text.substring(equalsIndex).trim();
      return text.trim();
    }
    case 'function': case 'method': case 'constructor': {
      const bodyStart = text.indexOf('{');
      return (bodyStart > -1 ? text.slice(0, bodyStart) : text).trim();
    }
    case 'arrow_function': {
      const arrowIndex = text.indexOf('=>');
      return arrowIndex > -1 ? text.slice(0, arrowIndex).trim() : text.trim();
    }
    default: return text.trim();
  }
};

const extractQualifiers = (childCaptures: TSMatch[], fileContent: string, handler: Partial<LanguageHandler>) => {
  const qualifiers: { [key: string]: TSNode } = {};
  for (const capture of childCaptures) qualifiers[capture.name] = capture.node;

  const visibility = (qualifiers['qualifier.visibility'] ? getNodeText(qualifiers['qualifier.visibility'], fileContent) : undefined) as CodeNodeVisibility | undefined;
  const returnType = qualifiers['symbol.returnType'] ? getNodeText(qualifiers['symbol.returnType'], fileContent).replace(/^:\s*/, '') : undefined;
  const parameters = qualifiers['symbol.parameters'] && handler.parseParameters ? handler.parseParameters(qualifiers['symbol.parameters'], fileContent) : undefined;
  const canThrow = childCaptures.some(c => c.name === 'qualifier.throws');

  return { qualifiers, visibility, returnType, parameters, canThrow, isAsync: !!qualifiers['qualifier.async'], isStatic: !!qualifiers['qualifier.static'] };
};

const getCssIntents = (ruleNode: TSNode, content: string): readonly ('layout' | 'typography' | 'appearance')[] => {
  const intents = new Set<'layout' | 'typography' | 'appearance'>();
  const layoutProps = /^(display|position|flex|grid|width|height|margin|padding|transform|align-|justify-)/;
  const typographyProps = /^(font|text-|line-height|letter-spacing|word-spacing)/;
  const appearanceProps = /^(background|border|box-shadow|opacity|color|fill|stroke|cursor)/;
  const block = ruleNode.childForFieldName('body') ?? ruleNode.namedChildren.find(c => c && c.type === 'block');

  if (block) {
    for (const declaration of block.namedChildren) {
      if (declaration && declaration.type === 'declaration') {
        const propNode = declaration.namedChildren.find(c => c && c.type === 'property_name');
        if (propNode) {
          const propName = getNodeText(propNode, content);
          if (layoutProps.test(propName)) intents.add('layout');
          if (typographyProps.test(propName)) intents.add('typography');
          if (appearanceProps.test(propName)) intents.add('appearance');
        }
      }
    }
  }
  return Array.from(intents).sort();
};

// --- LANGUAGE-SPECIFIC LOGIC ---

type LanguageHandler = {
  preProcessFile?: (file: FileContent, captures: TSMatch[]) => Record<string, any>;
  shouldSkipSymbol: (node: TSNode, symbolType: CodeNodeType, langName: string) => boolean;
  getSymbolNameNode: (declarationNode: TSNode, originalNode: TSNode) => TSNode | null;
  processComplexSymbol?: (context: ProcessSymbolContext) => boolean;
  parseParameters?: (paramsNode: TSNode, content: string) => { name: string; type?: string }[];
};

type ProcessSymbolContext = {
  nodes: CodeNode[];
  file: FileContent;
  node: TSNode;
  symbolType: CodeNodeType;
  processedSymbols: Set<string>;
  fileState: Record<string, any>;
  childCaptures: TSMatch[];
};

const pythonHandler: Partial<LanguageHandler> = {
  getSymbolNameNode: (declarationNode: TSNode) => {
    if (declarationNode.type === 'expression_statement') {
      const assignmentNode = declarationNode.namedChild(0);
      if (assignmentNode?.type === 'assignment') return assignmentNode.childForFieldName('left');
    }
    return declarationNode.childForFieldName('name');
  },
};

const goLangHandler: Partial<LanguageHandler> = {
  getSymbolNameNode: (declarationNode: TSNode) => {
    const nodeType = declarationNode.type;
    if (['type_declaration', 'const_declaration', 'var_declaration'].includes(nodeType)) {
      const spec = declarationNode.namedChild(0);
      if (spec && ['type_spec', 'const_spec', 'var_spec'].includes(spec.type)) return spec.childForFieldName('name');
    }
    return declarationNode.childForFieldName('name');
  },
};

const cLangHandler: Partial<LanguageHandler> = {
  getSymbolNameNode: (declarationNode: TSNode) => {
    if (declarationNode.type === 'type_definition') {
      const lastChild = declarationNode.namedChild(declarationNode.namedChildCount - 1);
      if (lastChild?.type === 'type_identifier') return lastChild;
    }
    if (declarationNode.type === 'function_definition') {
      const declarator = declarationNode.childForFieldName('declarator');
      if (declarator?.type === 'function_declarator') {
        const nameNode = declarator.childForFieldName('declarator');
        if (nameNode?.type === 'identifier') return nameNode;
      }
    }
    if (declarationNode.type === 'field_declaration') {
      const declarator = declarationNode.childForFieldName('declarator');
      if (declarator?.type === 'function_declarator') return declarator.childForFieldName('declarator');
      return declarator;
    }
    return declarationNode.childForFieldName('name');
  },
};

const tsLangHandler: Partial<LanguageHandler> = {
  preProcessFile: (_file, captures) => {
    const classNames = new Map<string, number>(); const duplicateClassNames = new Set<string>(); const seenClassNodes = new Set<number>();
    for (const { name, node } of captures) {
      if (name === 'class.definition') {
        let classNode = node.type === 'export_statement' ? (node.namedChildren[0] ?? node) : node;
        if (classNode.type === 'class_declaration' && !seenClassNodes.has(classNode.startIndex)) {
          seenClassNodes.add(classNode.startIndex);
          const nameNode = classNode.childForFieldName('name');
          if (nameNode) {
            const className = nameNode.text; const count = classNames.get(className) || 0;
            classNames.set(className, count + 1);
            if (count + 1 > 1) duplicateClassNames.add(className);
          }
        }
      }
    }
    return { duplicateClassNames };
  },
  shouldSkipSymbol: (node, symbolType, langName) => {
    if (langName !== 'typescript') return false;
    const valueNode = node.childForFieldName('value');
    if (valueNode?.type !== 'arrow_function') return false;
    return (symbolType === 'field' && node.type === 'public_field_definition') || (symbolType === 'variable' && node.type === 'variable_declarator');
  },
  getSymbolNameNode: (declarationNode, originalNode) => {
    if (originalNode.type === 'variable_declarator' || originalNode.type === 'public_field_definition') return originalNode.childForFieldName('name');
    if (declarationNode.type === 'export_statement') {
      const { firstNamedChild } = declarationNode;
      if (firstNamedChild?.type === 'arrow_function') {
        // For export default arrow functions, create a synthetic 'default' name
        return null; // Will be handled by fallback logic below
      }
      // Handle `export default function() {}`
      if (firstNamedChild?.type === 'function_declaration' && !firstNamedChild.childForFieldName('name')) {
        return null; // Will be handled by fallback logic below
      }
      const lexicalDecl = declarationNode.namedChildren[0];
      if (lexicalDecl?.type === 'lexical_declaration') {
        const varDeclarator = lexicalDecl.namedChildren[0];
        if (varDeclarator?.type === 'variable_declarator') return varDeclarator.childForFieldName('name');
      }
    }
    return declarationNode.childForFieldName('name');
  },
  processComplexSymbol: ({ nodes, file, node, symbolType, processedSymbols, fileState, childCaptures }) => {
    if (symbolType !== 'method' && symbolType !== 'field') return false;
    const classParent = node.parent?.parent;
    if (classParent?.type === 'class_declaration') {
      const classNameNode = classParent.childForFieldName('name');
      if (classNameNode) {
        const className = classNameNode.text;
        const nameNode = node.childForFieldName('name');
        if (nameNode && !fileState['duplicateClassNames']?.has(className)) {
          const methodName = nameNode.text;
          const unqualifiedSymbolId = `${file.path}#${methodName}`;
          if (!processedSymbols.has(unqualifiedSymbolId) && !nodes.some(n => n.id === unqualifiedSymbolId)) {
            processedSymbols.add(unqualifiedSymbolId);
            const codeSnippet = extractCodeSnippet(symbolType, node);
            const q = extractQualifiers(childCaptures, file.content, tsLangHandler);
            nodes.push({
              id: unqualifiedSymbolId, type: symbolType, name: methodName, filePath: file.path,
              startLine: getLineFromIndex(file.content, node.startIndex), endLine: getLineFromIndex(file.content, node.endIndex),
              codeSnippet, ...(q.isAsync && { isAsync: true }), ...(q.isStatic && { isStatic: true }),
              ...(q.visibility && { visibility: q.visibility }), ...(q.returnType && { returnType: q.returnType }),
              ...(q.parameters && { parameters: q.parameters }), ...(q.canThrow && { canThrow: true }),
            });
          }
          processedSymbols.add(`${file.path}#${methodName}`);
        }
      }
    }
    return true;
  },
  parseParameters: (paramsNode: TSNode, content: string): { name: string; type?: string }[] => {
    const params: { name: string; type?: string }[] = [];
    // Handle object destructuring in props: `({ prop1, prop2 })`
    if (paramsNode.type === 'object_pattern') {
      for (const child of paramsNode.namedChildren) {
        if (child && (child.type === 'shorthand_property_identifier' || child.type === 'property_identifier')) {
          params.push({ name: getNodeText(child, content), type: '#' });
        }
      }
      return params;
    }

    for (const child of paramsNode.namedChildren) {
      if (child && (child.type === 'required_parameter' || child.type === 'optional_parameter')) {
        const nameNode = child.childForFieldName('pattern');
        const typeNode = child.childForFieldName('type');
        if (nameNode) params.push({ name: getNodeText(nameNode, content), type: typeNode ? getNodeText(typeNode, content).replace(/^:\s*/, '') : undefined });
      }
    }
    return params;
  },
};

const phpHandler: Partial<LanguageHandler> = {
  getSymbolNameNode: (declarationNode: TSNode) => {
    if (declarationNode.type === 'namespace_definition') return declarationNode.childForFieldName('name');
    return declarationNode.childForFieldName('name');
  },
};

const languageHandlers: Record<string, Partial<LanguageHandler>> = {
  default: { shouldSkipSymbol: () => false, getSymbolNameNode: (declarationNode) => declarationNode.childForFieldName('name') },
  typescript: tsLangHandler, tsx: tsLangHandler,
  python: pythonHandler, go: goLangHandler, rust: goLangHandler,
  c: cLangHandler, cpp: cLangHandler, php: phpHandler,
};

const getLangHandler = (langName: string): LanguageHandler => ({ ...languageHandlers['default'], ...languageHandlers[langName] } as LanguageHandler);

function getSymbolTypeFromCapture(captureName: string, type: string): CodeNodeType | null {
  const baseMap = new Map<string, CodeNodeType>([
    ['class', 'class'], ['function', 'function'], ['function.arrow', 'arrow_function'], ['interface', 'interface'],
    ['type', 'type'], ['method', 'method'], ['field', 'field'], ['struct', 'struct'], ['enum', 'enum'],
    ['namespace', 'namespace'], ['trait', 'trait'], ['impl', 'impl'], ['constructor', 'constructor'], ['property', 'property'],
    ['html.element', 'html_element'], ['css.rule', 'css_rule'], ['variable', 'variable'], ['constant', 'constant'],
    ['static', 'static'], ['union', 'union'], ['template', 'template'],
  ]);
  return baseMap.get(captureName) ?? baseMap.get(type) ?? null;
}

function findEnclosingSymbolId(startNode: TSNode, file: FileContent, nodes: readonly CodeNode[]): string | null {
  let current: TSNode | null = startNode.parent;
  while (current) {
    const nodeType = current.type;
    // Prioritize function-like parents for accurate call linking
    if (['function_declaration', 'method_definition', 'arrow_function', 'function_definition'].includes(nodeType)) {
      const nameNode = current.childForFieldName('name');
      if (nameNode) {
        let symbolName = nameNode.text;
        // Handle class methods
        if (nodeType === 'method_definition') {
          const classNode = current.parent?.parent;
          if (classNode?.type === 'class_declaration') {
            const className = classNode.childForFieldName('name')?.text;
            if (className) symbolName = `${className}.${symbolName}`;
          }
        }
        const symbolId = `${file.path}#${symbolName}`;
        if (nodes.some(n => n.id === symbolId)) return symbolId;
      }
    }
    // Fallback for other symbol types
    if (current.type === 'jsx_opening_element') {
      const tagNameNode = current.childForFieldName('name');
      if (tagNameNode) {
        const tagName = tagNameNode.text, lineNumber = tagNameNode.startPosition.row + 1;
        const symbolId = `${file.path}#${tagName}:${lineNumber}`;
        if (nodes.some(n => n.id === symbolId)) return symbolId;
      }
    }
    const nameNode = current.childForFieldName('name');
    if (nameNode) {
      let symbolName = nameNode.text;
      if (current.type === 'method_definition' || (current.type === 'public_field_definition' && !current.text.includes('=>'))) {
        const classNode = current.parent?.parent;
        if (classNode?.type === 'class_declaration') symbolName = `${classNode.childForFieldName('name')?.text}.${symbolName}`;
      }
      const symbolId = `${file.path}#${symbolName}`;
      if (nodes.some(n => n.id === symbolId)) return symbolId;
    }
    current = current.parent;
  }
  return file.path;
}

function processSymbol(context: ProcessSymbolContext, langConfig: LanguageConfig): void {
  const { nodes, file, node, symbolType, processedSymbols, childCaptures } = context;
  const handler = getLangHandler(langConfig.name);

  if (handler.shouldSkipSymbol(node, symbolType, langConfig.name)) return;
  if (handler.processComplexSymbol?.(context)) return;

  // Skip local variable declarations inside functions
  if (symbolType === 'variable') {
    let current = node.parent;
    while (current) {
      if (['function_declaration', 'arrow_function', 'method_definition'].includes(current.type)) {
        return; // Skip this variable as it's inside a function
      }
      current = current.parent;
    }
  }

  let declarationNode = node;
  if (node.type === 'export_statement' && node.namedChildCount > 0) declarationNode = node.namedChildren[0] ?? node;

  const q = extractQualifiers(childCaptures, file.content, handler);
  let nameNode = handler.getSymbolNameNode(declarationNode, node) || q.qualifiers['html.tag'] || q.qualifiers['css.selector'];

  if (symbolType === 'css_rule' && !nameNode) {
    const selectorsNode = node.childForFieldName('selectors') || node.namedChildren.find(c => c && c.type === 'selectors');
    if (selectorsNode) nameNode = selectorsNode.namedChildren[0] ?? undefined;
  }

  let symbolName: string;
  if (!nameNode) {
    // Handle export default anonymous functions
    if (node.type === 'export_statement') {
      const firstChild = node.firstNamedChild;
      if (firstChild?.type === 'arrow_function' ||
        (firstChild?.type === 'function_declaration' && !firstChild.childForFieldName('name'))) {
        symbolName = 'default';
      } else {
        return;
      }
    } else {
      return;
    }
  } else {
    symbolName = nameNode.text;
  }

  let symbolId = `${file.path}#${symbolName}`;
  if (symbolType === 'html_element' && nameNode) symbolId = `${file.path}#${symbolName}:${nameNode.startPosition.row + 1}`;

  if (symbolName && !processedSymbols.has(symbolId) && !nodes.some(n => n.id === symbolId)) {
    processedSymbols.add(symbolId);
    const isHtmlElement = symbolType === 'html_element', isCssRule = symbolType === 'css_rule';
    const cssIntents = isCssRule ? getCssIntents(node, file.content) : undefined;
    const codeSnippet = extractCodeSnippet(symbolType, node);
    nodes.push({
      id: symbolId, type: symbolType, name: symbolName, filePath: file.path,
      startLine: getLineFromIndex(file.content, node.startIndex), endLine: getLineFromIndex(file.content, node.endIndex),
      codeSnippet, ...(q.isAsync && { isAsync: true }), ...(q.isStatic && { isStatic: true }),
      ...(q.visibility && { visibility: q.visibility }), ...(q.returnType && { returnType: q.returnType }),
      ...(q.parameters && { parameters: q.parameters }), ...(q.canThrow && { canThrow: true }),
      ...(isHtmlElement && { htmlTag: symbolName }), ...(isCssRule && { cssSelector: symbolName }),
      ...(cssIntents && { cssIntents }),
    });
  }
}

// --- MAIN WORKER FUNCTION ---

export default async function processFile({ file, langConfig }: { file: FileContent; langConfig: LanguageConfig; }) {
  const nodes: CodeNode[] = [];
  const relations: UnresolvedRelation[] = [];
  const processedSymbols = new Set<string>();

  const parser = await createParserForLanguage(langConfig);
  if (!parser.language) return { nodes, relations };

  const query = new (await import('web-tree-sitter')).Query(parser.language, langConfig.query);
  const tree = parser.parse(file.content);
  if (!tree) return { nodes, relations };
  const captures = query.captures(tree.rootNode);

  // --- Phase 1: Definitions ---
  const handler = getLangHandler(langConfig.name);
  const fileState = handler.preProcessFile?.(file, captures) || {};
  const definitionCaptures = captures.filter(({ name }) => name.endsWith('.definition'));
  const otherCaptures = captures.filter(({ name }) => !name.endsWith('.definition'));

  for (const { name, node } of definitionCaptures) {
    const parts = name.split('.');
    const type = parts.slice(0, -1).join('.');
    const symbolType = getSymbolTypeFromCapture(name, type);
    if (!symbolType) continue;

    const childCaptures = otherCaptures.filter((c) => c.node.startIndex >= node.startIndex && c.node.endIndex <= node.endIndex);
    processSymbol({ nodes, file, node, symbolType, processedSymbols, fileState, childCaptures }, langConfig);
  }

  // --- Phase 2: Relationships ---
  for (const { name, node } of captures) {
    const parts = name.split('.');
    const type = parts.slice(0, -1).join('.');
    const subtype = parts[parts.length - 1];

    if (type === 'import' && subtype === 'source') {
      const importPath = getNodeText(node, file.content).replace(/['"`]/g, '');
      relations.push({ fromId: file.path, toName: importPath, type: 'imports' });

      // Handle re-exports, e.g., `export * from './other';`
      const exportParent = node.parent?.parent;
      if (exportParent?.type === 'export_statement') {
        // This creates a file-level dependency, which is what SCN represents.
        // NOTE: The 'exports' relation type is not defined, causing a TS error.
        // A simple 'imports' relation is already created above, which is sufficient
        // for file-level dependency tracking. Deeper re-export symbol resolution
        // is not yet implemented.
        // relations.push({ fromId: file.path, toName: importPath, type: 'exports' });
      }
      continue;
    }

    if (name === 'css.class.reference' || name === 'css.id.reference') {
      const fromId = findEnclosingSymbolId(node, file, nodes);
      if (!fromId) continue;

      const fromNode = nodes.find(n => n.id === fromId);
      if (fromNode?.type !== 'html_element') continue;

      const text = getNodeText(node, file.content).replace(/['"`]/g, '');
      const prefix = name === 'css.id.reference' ? '#' : '.';
      const selectors = (prefix === '.') ? text.split(' ').filter(Boolean).map(s => '.' + s) : [prefix + text];

      for (const selector of selectors) relations.push({ fromId, toName: selector, type: 'reference' });
      continue;
    }

    if (subtype && ['inheritance', 'implementation', 'call', 'reference'].includes(subtype)) {
      const fromId = findEnclosingSymbolId(node, file, nodes);
      if (!fromId) continue;

      const toName = getNodeText(node, file.content).replace(/<.*>$/, '');
      const edgeType = subtype === 'inheritance' ? 'inherits' : subtype === 'implementation' ? 'implements' : 'reference';
      relations.push({ fromId, toName, type: edgeType });
    }
  }

  return { nodes, relations };
}
````

## File: src/composer.ts
````typescript
import path from 'node:path';
import type { Analyzer, FileDiscoverer, Ranker, Renderer, RepoGraphMap } from './types';
import { logger } from './utils/logger.util';
import { writeFile } from './utils/fs.util';

type MapGenerator = (config: {
  readonly root: string;
  readonly output?: string;
  readonly include?: readonly string[];
  readonly ignore?: readonly string[];
  readonly noGitignore?: boolean;
  readonly rendererOptions?: any;
}) => Promise<RepoGraphMap>;

/**
 * A Higher-Order Function that takes pipeline functions as arguments and
 * returns a fully configured `generate` function for creating a codemap.
 * This is the core of RepoGraph's composability.
 *
 * @param pipeline An object containing implementations for each pipeline stage.
 * @returns An asynchronous function to generate and write the codemap.
 */
export const createMapGenerator = (pipeline: {
  readonly discover: FileDiscoverer;
  readonly analyze: Analyzer;
  readonly rank: Ranker;
  readonly render: Renderer;
}): MapGenerator => {
  if (
    !pipeline ||
    typeof pipeline.discover !== 'function' ||
    typeof pipeline.analyze !== 'function' ||
    typeof pipeline.rank !== 'function' ||
    typeof pipeline.render !== 'function'
  ) {
    throw new Error('createMapGenerator: A valid pipeline object with discover, analyze, rank, and render functions must be provided.');
  }
  return async (config) => {
    const { root, output, include, ignore, noGitignore, rendererOptions } = config;

    let stage = 'discover';
    try {
      logger.info('1/4 Discovering files...');
      const files = await pipeline.discover({ root, include, ignore, noGitignore });
      logger.debug(`  -> Found ${files.length} files to analyze.`);

      stage = 'analyze';
      logger.info('2/4 Analyzing code and building graph...');
      const graph = await pipeline.analyze(files);
      logger.debug(`  -> Built graph with ${graph.nodes.size} nodes and ${graph.edges.length} edges.`);

      stage = 'rank';
      logger.info('3/4 Ranking graph nodes...');
      const rankedGraph = await pipeline.rank(graph);
      logger.debug('  -> Ranking complete.');

      stage = 'render';
      logger.info('4/4 Rendering output...');
      const markdown = pipeline.render(rankedGraph, rendererOptions);
      logger.debug('  -> Rendering complete.');

      if (output) {
        const outputPath = path.isAbsolute(output) ? output : path.resolve(root, output);
        stage = 'write';
        logger.info(`Writing report to ${path.relative(process.cwd(), outputPath)}...`);
        await writeFile(outputPath, markdown);
        logger.info('  -> Report saved.');
      }

      return { graph: rankedGraph, markdown };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stageErrorMessage = stage === 'write' ? `Failed to write output file` : `Error in ${stage} stage`;
      // We will create a new error to wrap the original one, preserving its stack.
      const newError = new Error(`${stageErrorMessage}: ${message}`);
      if (error instanceof Error && error.stack) {
        newError.stack = `${newError.stack}\nCaused by: ${error.stack}`;
      }
      throw newError;
    }
  };
};
````

## File: src/pipeline/rank.ts
````typescript
import pagerank from 'graphology-pagerank';
import Graph from 'graphology';
import type { CodeGraph, Ranker, RankedCodeGraph } from '../types';

import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.util';

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

/**
 * Creates a ranker based on Git commit history. Files changed more frequently are considered
 * more important. Requires Git to be installed.
 * @returns A Ranker function.
 */
export const createGitRanker = (options: { maxCommits?: number } = {}): Ranker => {
  return async (graph: CodeGraph): Promise<RankedCodeGraph> => {
    const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
    if (isBrowser) {
      logger.warn('GitRanker is not supported in the browser. Returning 0 for all ranks.');
      const ranks = new Map<string, number>();
      for (const [nodeId] of graph.nodes) {
        ranks.set(nodeId, 0);
      }
      return { ...graph, ranks };
    }

    const { maxCommits = 500 } = options;
    const ranks = new Map<string, number>();

    if (graph.nodes.size === 0) {
      return { ...graph, ranks };
    }

    try {
      const command = `git log --max-count=${maxCommits} --name-only --pretty=format:`;
      const output = execSync(command, { encoding: 'utf-8' });
      const files = output.split('\n').filter(Boolean);

      const changeCounts: Record<string, number> = {};
      for (const file of files) {
        changeCounts[file] = (changeCounts[file] || 0) + 1;
      }

      const maxChanges = Math.max(...Object.values(changeCounts), 1);

      for (const [nodeId, attributes] of graph.nodes) {
        // We only rank file nodes with this strategy
        if (attributes.type === 'file') {
          const count = changeCounts[attributes.filePath] ?? 0;
          ranks.set(nodeId, count / maxChanges); // Normalize score
        } else {
          ranks.set(nodeId, 0);
        }
      }
    } catch (e) {
      // This is not a fatal error for the whole process, but this ranker cannot proceed.
      logger.warn('Failed to use \'git\' for ranking. Is git installed and is this a git repository? Returning 0 for all ranks.');
      for (const [nodeId] of graph.nodes) {
        ranks.set(nodeId, 0);
      }
    }

    return { ...graph, ranks };
  };
};
````

## File: src/high-level.ts
````typescript
import { createDefaultDiscoverer } from './pipeline/discover';
import { createTreeSitterAnalyzer } from './pipeline/analyze';
import { createPageRanker, createGitRanker } from './pipeline/rank';
import { createMarkdownRenderer } from './pipeline/render';
import type { RepoGraphOptions, Ranker, RankedCodeGraph, FileContent } from './types';
import path from 'node:path';
import { logger } from './utils/logger.util';
import { writeFile } from './utils/fs.util';
import { RepoGraphError } from './utils/error.util';

const selectRanker = (rankingStrategy: RepoGraphOptions['rankingStrategy'] = 'pagerank'): Ranker => {
  if (rankingStrategy === 'git-changes') {
    return createGitRanker();
  }
  if (rankingStrategy === 'pagerank') {
    return createPageRanker();
  }
  throw new Error(`Invalid ranking strategy: '${rankingStrategy}'. Available options are 'pagerank', 'git-changes'.`);
};

/**
 * A mid-level API for programmatically generating and receiving the code graph
 * without rendering it to a file. Ideal for integration with other tools.
 *
 * @param options The configuration object for generating the map.
 * @returns The generated `RankedCodeGraph`.
 */
export const analyzeProject = async (options: RepoGraphOptions = {}): Promise<RankedCodeGraph> => {
  const { root, logLevel, include, ignore, noGitignore, maxWorkers, files: inputFiles } = options;
  const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';

  if (logLevel) {
    logger.setLevel(logLevel);
  }

  // Validate options before entering the main try...catch block to provide clear errors.
  const ranker = selectRanker(options.rankingStrategy);

  try {
    let files: readonly FileContent[];
    if (inputFiles && inputFiles.length > 0) {
      logger.info('1/3 Using provided files...');
      files = inputFiles;
    } else {
      if (isBrowser) {
        throw new RepoGraphError('File discovery is not supported in the browser. Please provide the `files` option with file content.');
      }
      const effectiveRoot = root || process.cwd();
      logger.info(`1/3 Discovering files in "${effectiveRoot}"...`);
      const discoverer = createDefaultDiscoverer();
      files = await discoverer({ root: path.resolve(effectiveRoot), include, ignore, noGitignore });
    }
    logger.debug(`  -> Found ${files.length} files to analyze.`);

    logger.info('2/3 Analyzing code and building graph...');
    const analyzer = createTreeSitterAnalyzer({ maxWorkers });
    const graph = await analyzer(files);
    logger.debug(`  -> Built graph with ${graph.nodes.size} nodes and ${graph.edges.length} edges.`);

    logger.info('3/3 Ranking graph nodes...');
    const rankedGraph = await ranker(graph);
    logger.debug('  -> Ranking complete.');

    return rankedGraph;
  } catch (error) {
    throw new RepoGraphError(`Failed to analyze project`, error);
  }
};

/**
 * The primary, easy-to-use entry point for RepoGraph. It orchestrates the
 * default pipeline based on a configuration object to generate a codemap.
 *
 * @param options The configuration object for generating the map.
 */
export const generateMap = async (options: RepoGraphOptions = {}): Promise<void> => {
  const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
  if (isBrowser) {
    throw new RepoGraphError('`generateMap` is not supported in the browser because it cannot write to the file system. Use `analyzeProject` and a `Renderer` instead.');
  }

  const finalOptions = { ...options, logLevel: options.logLevel ?? 'info' };

  const {
    root = process.cwd(),
    output = './repograph.md',
  } = finalOptions;

  try {
    // We get the full ranked graph first
    const rankedGraph = await analyzeProject(finalOptions);

    logger.info('4/4 Rendering output...');
    const renderer = createMarkdownRenderer();
    const markdown = renderer(rankedGraph, finalOptions.rendererOptions);
    logger.debug('  -> Rendering complete.');

    const outputPath = path.isAbsolute(output) ? output : path.resolve(root, output);

    logger.info(`Writing report to ${path.relative(process.cwd(), outputPath)}...`);
    await writeFile(outputPath, markdown);
    logger.info('  -> Report saved.');
  } catch (error) {
    // The underlying `analyzeProject` already wraps the error, so we just re-throw.
    throw error;
  }
};
````

## File: src/types.ts
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
  readonly cssIntents?: readonly CssIntent[]; // Not implemented yet
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

/** Configuration options for the main `generateMap` function. */
export type RepoGraphOptions = {
  /**
   * Root directory to analyze. Not used if `files` is provided.
   * @default process.cwd() in Node.js.
   */
  readonly root?: string;
  /**
   * Output path for the Markdown file. Writing files is not supported in the browser.
   * @default './repograph.md'
   */
  readonly output?: string;
  /** Glob patterns for files to include. Not used if `files` is provided. */
  readonly include?: readonly string[];
  /** Glob patterns for files to exclude. Not used if `files` is provided. */
  readonly ignore?: readonly string[];
  /** Disables the use of .gitignore. Not used if `files` is provided. @default false */
  readonly noGitignore?: boolean;
  /** The ranking strategy to use. @default 'pagerank' */
  readonly rankingStrategy?: 'pagerank' | 'git-changes';
  /** Configuration for the final Markdown output. */
  readonly rendererOptions?: RendererOptions;
  /**
   * The maximum number of parallel workers to use for analysis.
   * When set to 1, analysis runs in the main thread without workers.
   * @default 1
   */
  readonly maxWorkers?: number;
  /** Logging level. @default 'info' */
  readonly logLevel?: 'silent' | 'error' | 'warn' | 'info' | 'debug';
  /**
   * Optional. An array of file content objects to analyze.
   * If provided, the file discovery step (including `root`, `include`, `ignore`, `noGitignore`) will be skipped.
   * This is useful for browser-based environments or when file discovery is handled externally.
   */
  readonly files?: readonly FileContent[];
};

// Low-Level Functional Pipeline Contracts

/** Discovers files and returns their content. */
export type FileDiscoverer = (config: {
  readonly root: string;
  readonly include?: readonly string[];
  readonly ignore?: readonly string[];
  readonly noGitignore?: boolean;
}) => Promise<readonly FileContent[]>;

/** Analyzes file content and builds the dependency graph. */
export type Analyzer = (files: readonly FileContent[]) => Promise<CodeGraph>;

/** Ranks the nodes in a graph. */
export type Ranker = (graph: CodeGraph) => Promise<RankedCodeGraph>;

/** Renders a ranked graph into a string format. */
export type Renderer = (rankedGraph: RankedCodeGraph, options?: RendererOptions) => string;
````

## File: src/index.ts
````typescript
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

    // We need a mutable version of the options to build it from arguments.
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
        case '--max-workers':
          options.maxWorkers = parseInt(args[++i] as string, 10);
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
````

## File: src/tree-sitter/language-config.ts
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
    wasmPath: 'wasm/tree-sitter-typescript.wasm',
    query: TS_BASE_QUERY
  },
  {
    name: 'tsx',
    extensions: ['.tsx', '.jsx'],
    wasmPath: 'wasm/tree-sitter-tsx.wasm',
    query: `${TS_BASE_QUERY}\n${TSX_SPECIFIC_QUERY}`
  },
  {
    name: 'python',
    extensions: ['.py', '.pyw'],
    wasmPath: 'wasm/tree-sitter-python.wasm',
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
    wasmPath: 'wasm/tree-sitter-java.wasm',
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
    wasmPath: 'wasm/tree-sitter-cpp.wasm',
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
    wasmPath: 'wasm/tree-sitter-c.wasm',
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
    wasmPath: 'wasm/tree-sitter-go.wasm',
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
    wasmPath: 'wasm/tree-sitter-rust.wasm',
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
    wasmPath: 'tree-sitter-c-sharp/tree-sitter-c_sharp.wasm',
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
    wasmPath: 'wasm/tree-sitter-php.wasm',
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
    wasmPath: 'wasm/tree-sitter-ruby.wasm',
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
    wasmPath: 'tree-sitter-solidity/tree-sitter-solidity.wasm',
    query: `
      (contract_declaration) @class.definition
      (function_definition) @function.definition
      (event_definition) @enum.definition
    `
  },
  {
    name: 'swift',
    extensions: ['.swift'],
    wasmPath: 'tree-sitter-swift/tree-sitter-swift.wasm',
    query: `
      (class_declaration) @class.definition
      (protocol_declaration) @trait.definition
      (function_declaration) @function.definition
      (protocol_function_declaration) @function.definition
      (property_declaration) @field.definition
    `
  },
  {
    name: 'vue',
    extensions: ['.vue'],
    wasmPath: 'tree-sitter-vue/tree-sitter-vue.wasm',
    query: `
      (script_element .
        [
          (lexical_declaration (variable_declarator)) @variable.definition
          (function_declaration) @function.definition
        ])

      (element
        (start_tag
          (tag_name) @html.tag
        )
      ) @html.element.definition
`
  },
  {
    name: 'css',
    extensions: ['.css'],
    wasmPath: 'wasm/tree-sitter-css.wasm',
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

## File: src/pipeline/analyze.ts
````typescript
const browserPath = {
  normalize: (p: string) => p.replace(/\\/g, '/'),
  dirname: (p: string) => {
    const i = p.lastIndexOf('/');
    return i > -1 ? p.substring(0, i) : '.';
  },
  join: (...args: string[]): string => {
    const path = args.join('/');
    // This is a simplified resolver that handles '..' and '.'
    const segments = path.split('/');
    const resolved: string[] = [];
    for (const segment of segments) {
      if (segment === '..') {
        resolved.pop();
      } else if (segment !== '.' || resolved.length === 0) {
        if (segment !== '') resolved.push(segment);
      }
    }
    return resolved.join('/') || (segments.length > 0 && segments.every(s => s === '.' || s === '') ? '.' : '');
  },
  extname: (p: string) => {
    const i = p.lastIndexOf('.');
    return i > p.lastIndexOf('/') ? p.substring(i) : '';
  },
  parse: (p: string) => {
    const ext = browserPath.extname(p);
    const base = p.substring(p.lastIndexOf('/') + 1);
    const name = base.substring(0, base.length - ext.length);
    const dir = browserPath.dirname(p);
    return { dir, base, name, ext, root: '' };
  },
  basename: (p: string) => p.substring(p.lastIndexOf('/') + 1),
};

import type { Analyzer, CodeNode, CodeEdge, FileContent, UnresolvedRelation } from '../types';
import { getLanguageConfigForFile, type LanguageConfig } from '../tree-sitter/language-config';
import { logger } from '../utils/logger.util';
import { ParserError } from '../utils/error.util';
import processFileInWorker from './analyzer.worker';

const normalizePath = browserPath.normalize;

// --- LANGUAGE-SPECIFIC IMPORT RESOLUTION LOGIC ---
// This part is needed on the main thread to resolve import paths.

const createModuleResolver = (extensions: string[]) => (fromFile: string, sourcePath: string, allFiles: string[]): string | null => {
  const basedir = normalizePath(browserPath.dirname(fromFile));
  const importPath = normalizePath(browserPath.join(basedir, sourcePath));

  // First, check if the path as-is (with extension) exists
  if (browserPath.extname(importPath) && allFiles.includes(importPath)) {
    return importPath;
  }

  // Also try without the './' prefix for root-level files with extensions
  if (browserPath.extname(importPath) && importPath.startsWith('./')) {
    const withoutDotSlash = importPath.substring(2);
    if (allFiles.includes(withoutDotSlash)) return withoutDotSlash;
  }

  const parsedPath = browserPath.parse(importPath);
  const basePath = normalizePath(browserPath.join(parsedPath.dir, parsedPath.name));

  // Try with extensions
  for (const ext of extensions) {
      const potentialFile = basePath + ext;
      if (allFiles.includes(potentialFile)) return potentialFile;

      // Also try without the './' prefix for root-level files
      if (potentialFile.startsWith('./')) {
        const withoutDotSlash = potentialFile.substring(2);
        if (allFiles.includes(withoutDotSlash)) return withoutDotSlash;
      }
  }

  for (const ext of extensions) {
      const potentialIndexFile = normalizePath(browserPath.join(importPath, 'index' + ext));
      if (allFiles.includes(potentialIndexFile)) return potentialIndexFile;

      // Also try without the './' prefix for root-level files
      if (potentialIndexFile.startsWith('./')) {
        const withoutDotSlash = potentialIndexFile.substring(2);
        if (allFiles.includes(withoutDotSlash)) return withoutDotSlash;
      }
  }

  if (allFiles.includes(importPath)) return importPath;
  return null;
};

const resolveImportFactory = (endings: string[], packageStyle: boolean = false) => (fromFile: string, sourcePath: string, allFiles: string[]): string | null => {
  const basedir = normalizePath(browserPath.dirname(fromFile));
  const resolvedPathAsIs = normalizePath(browserPath.join(basedir, sourcePath));
  if (allFiles.includes(resolvedPathAsIs)) return resolvedPathAsIs;

  const parsedSourcePath = browserPath.parse(sourcePath);
  const basePath = normalizePath(browserPath.join(basedir, parsedSourcePath.dir, parsedSourcePath.name));
  for (const end of endings) {
    const potentialPath = basePath + end;
    if (allFiles.includes(potentialPath)) return potentialPath;
  }

  if (packageStyle && sourcePath.includes('.')) {
    const packagePath = normalizePath(sourcePath.replace(/\./g, '/'));
    for (const end of endings) {
      const fileFromRoot = packagePath + end;
      if (allFiles.includes(fileFromRoot)) return fileFromRoot;
    }
  }
  return null;
};

type ImportResolver = (fromFile: string, sourcePath: string, allFiles: string[]) => string | null;

const languageImportResolvers: Record<string, ImportResolver> = {
  default: (fromFile, sourcePath, allFiles) => {
    const resolvedPathAsIs = browserPath.normalize(browserPath.join(browserPath.dirname(fromFile), sourcePath));
    return allFiles.includes(resolvedPathAsIs) ? resolvedPathAsIs : null;
  },
  typescript: createModuleResolver(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css']),
  javascript: createModuleResolver(['.js', 'jsx', '.mjs', '.cjs']),
  tsx: createModuleResolver(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css']),
  python: (fromFile: string, sourcePath: string, allFiles: string[]): string | null => {
    if (sourcePath.startsWith('.')) {
      const level = sourcePath.match(/^\.+/)?.[0]?.length ?? 0;
      const modulePath = sourcePath.substring(level).replace(/\./g, '/');
      let currentDir = normalizePath(browserPath.dirname(fromFile));
      for (let i = 1; i < level; i++) currentDir = browserPath.dirname(currentDir);
      const targetPyFile = normalizePath(browserPath.join(currentDir, modulePath) + '.py');
      if (allFiles.includes(targetPyFile)) return targetPyFile;
      const resolvedPath = normalizePath(browserPath.join(currentDir, modulePath, '__init__.py'));
      if (allFiles.includes(resolvedPath)) return resolvedPath;
    }
    return resolveImportFactory(['.py', '/__init__.py'])(fromFile, sourcePath, allFiles);
  },
  java: resolveImportFactory(['.java'], true),
  csharp: resolveImportFactory(['.cs'], true),
  php: resolveImportFactory(['.php']),
  rust: (fromFile: string, sourcePath: string, allFiles: string[]): string | null => {
    const basedir = normalizePath(browserPath.dirname(fromFile));
    const resolvedPath = normalizePath(browserPath.join(basedir, sourcePath + '.rs'));
    if (allFiles.includes(resolvedPath)) return resolvedPath;
    return resolveImportFactory(['.rs', '/mod.rs'])(fromFile, sourcePath, allFiles);
  },
};

const getImportResolver = (langName: string): ImportResolver => languageImportResolvers[langName] ?? languageImportResolvers['default']!;

class SymbolResolver {
  private fileImports = new Map<string, string[]>();

  constructor(private nodes: ReadonlyMap<string, CodeNode>, edges: readonly CodeEdge[]) {
    for (const edge of edges) {
      if (edge.type === 'imports') {
        if (!this.fileImports.has(edge.fromId)) this.fileImports.set(edge.fromId, []);
        this.fileImports.get(edge.fromId)!.push(edge.toId);
      }
    }
  }

  resolve(symbolName: string, contextFile: string): CodeNode | null {
    // 1. Same file
    const sameFileId = `${contextFile}#${symbolName}`;
    if (this.nodes.has(sameFileId)) return this.nodes.get(sameFileId)!;

    // 2. Imported files
    const importedFiles = this.fileImports.get(contextFile) || [];
    for (const file of importedFiles) {
      const importedId = `${file}#${symbolName}`;
      if (this.nodes.has(importedId)) return this.nodes.get(importedId)!;
    }

    // 3. CSS Selector
    for (const node of this.nodes.values()) {
        if (node.type === 'css_rule' && node.cssSelector === symbolName) return node;
    }

    // 4. Global fallback
    for (const node of this.nodes.values()) {
      if (node.name === symbolName && ['class', 'function', 'interface', 'struct', 'type', 'enum'].includes(node.type)) {
        return node;
      }
    }

    return null;
  }
}

export const createTreeSitterAnalyzer = (options: { maxWorkers?: number } = {}): Analyzer => {
  const { maxWorkers = 1 } = options;

  return async (files: readonly FileContent[]) => {
    const nodes = new Map<string, CodeNode>();
    let unresolvedRelations: UnresolvedRelation[] = [];
    const allFilePaths = files.map(f => normalizePath(f.path));

    for (const file of files) {
      const langConfig = getLanguageConfigForFile(normalizePath(file.path));
      nodes.set(file.path, {
        id: file.path, type: 'file', name: browserPath.basename(file.path),
        filePath: file.path, startLine: 1, endLine: file.content.split('\n').length,
        language: langConfig?.name,
      });
    }

    const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
    const filesToProcess = files.map(file => ({ file, langConfig: getLanguageConfigForFile(normalizePath(file.path)) }))
      .filter((item): item is { file: FileContent, langConfig: LanguageConfig } => !!item.langConfig);

    if (maxWorkers > 1 && !isBrowser) {
      logger.debug(`Analyzing files in parallel with ${maxWorkers} workers.`);
      const { default: Tinypool } = await import('tinypool');
      const { fileURLToPath } = await import('node:url');
      const { URL } = await import('node:url');

      const pool = new Tinypool({
        filename: fileURLToPath(new URL('analyzer.worker.js', import.meta.url)),
        maxThreads: maxWorkers,
      });

      const tasks = filesToProcess.map(item => pool.run(item));
      const results = await Promise.all(tasks);

      for (const result of results) {
        if (result) {
          result.nodes.forEach((node: CodeNode) => nodes.set(node.id, node));
          unresolvedRelations.push(...result.relations);
        }
      }
    } else {
      if (maxWorkers > 1 && isBrowser) {
        logger.warn('Parallel analysis with workers is not supported in the browser. Falling back to sequential analysis.');
      }
      logger.debug(`Analyzing files sequentially in the main thread.`);
      for (const item of filesToProcess) {
        try {
          const result = await processFileInWorker(item);
          if (result) {
            result.nodes.forEach(node => nodes.set(node.id, node));
            unresolvedRelations.push(...result.relations);
          }
        } catch(error) {
          logger.warn(new ParserError(`Failed to process ${item.file.path}`, item.langConfig.name, error));
        }
      }
    }

    // --- Phase 3: Resolve all relationships ---
    const edges: CodeEdge[] = [];
    const importEdges: CodeEdge[] = [];

    // Resolve imports first, as they are needed by the SymbolResolver
    for (const rel of unresolvedRelations) {
      if (rel.type === 'imports') {
        const fromNode = nodes.get(rel.fromId);
        if (!fromNode || fromNode.type !== 'file' || !fromNode.language) continue;

        const resolver = getImportResolver(fromNode.language);
        const toId = resolver(rel.fromId, rel.toName, allFilePaths);
        if (toId && nodes.has(toId)) {
          importEdges.push({ fromId: rel.fromId, toId, type: 'imports' });
        }
      }
    }

    const symbolResolver = new SymbolResolver(nodes, importEdges);

    for (const rel of unresolvedRelations) {
        if (rel.type === 'imports') continue; // Already handled

        const toNode = symbolResolver.resolve(rel.toName, rel.fromId.split('#')[0]!);
        if (toNode && rel.fromId !== toNode.id) {
          const edgeType = rel.type === 'reference' ? 'calls' : rel.type;
          edges.push({ fromId: rel.fromId, toId: toNode.id, type: edgeType });
        }
    }

    const finalEdges = [...importEdges, ...edges];
    // Remove duplicates
    const uniqueEdges = [...new Map(finalEdges.map(e => [`${e.fromId}->${e.toId}->${e.type}`, e])).values()];

    return { nodes: Object.freeze(nodes), edges: Object.freeze(uniqueEdges) };
  };
};
````

## File: package.json
````json
{
  "name": "repograph",
  "version": "0.1.36",
  "description": "Your Codebase, Visualized. Generate rich, semantic, and interactive codemaps with a functional, composable API.",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "repograph": "./dist/index.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "browser": {
        "types": "./dist/browser.d.ts",
        "import": "./dist/browser.js",
        "require": "./dist/browser.cjs"
      },
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./browser": {
      "types": "./dist/browser.d.ts",
      "import": "./dist/browser.js",
      "require": "./dist/browser.cjs"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsup",
    "prepublishOnly": "npm run build",
    "dev": "tsup --watch",
    "test": "bun run test/run-tests.ts",
    "test:unit": "bun run test/run-tests.ts unit",
    "test:integration": "bun run test/run-tests.ts integration",
    "test:e2e": "bun run test/run-tests.ts e2e",
    "test:watch": "bun test --watch test/**/*.test.ts",
    "test:coverage": "bun test --coverage test/**/*.test.ts",
    "test:basic": "bun test test-basic.js",
    "lint": "eslint . --ext .ts",
    "format": "prettier --write \"src/**/*.ts\""
  },
  "dependencies": {
    "tinypool": "^0.8.2",
    "@types/js-yaml": "^4.0.9",
    "globby": "^14.1.0",
    "graphology": "^0.26.0",
    "graphology-pagerank": "^1.1.0",
    "js-yaml": "^4.1.0",
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
    "tree-sitter-swift": "^0.7.1",
    "tree-sitter-typescript": "^0.23.2",
    "tree-sitter-vue": "^0.2.1",
    "web-tree-sitter": "^0.25.6"
  },
  "devDependencies": {
    "@types/node": "^20.12.12",
    "bun-types": "^1.1.12",
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
    "repo-analysis",
    "ai-context",
    "bun",
    "functional-programming"
  ],
  "author": "RelayCoder <you@example.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/relaycoder/repograph.git"
  },
  "homepage": "https://github.com/relaycoder/repograph#readme",
  "bugs": {
    "url": "https://github.com/relaycoder/repograph/issues"
  },
  "engines": {
    "node": ">=18.0.0",
    "bun": ">=1.0.0"
  }
}
````
