# Directory Structure
```
src/
  pipeline/
    analyze.ts
    analyzer.worker.ts
    discover.ts
    rank.ts
    render.ts
  tree-sitter/
    language-config.ts
    languages.ts
    queries.ts
  types/
    graphology-pagerank.d.ts
  utils/
    error.util.ts
    fs.util.ts
    logger.util.ts
  composer.ts
  high-level.ts
  index.ts
  types.ts
package.json
tsconfig.json
tsup.config.ts
```

# Files

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

## File: tsup.config.ts
````typescript
import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export default defineConfig({
  entry: ['src/index.ts', 'src/pipeline/analyzer.worker.ts'],
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

    // Type roots
    "typeRoots": ["./node_modules/@types", "./src/types", "./test/**/*"]
  }
}
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

      logger.debug(`Trying WASM paths: dist=${distWasmPath}, nodeModules=${nodeModulesWasmPath}, published=${publishedWasmPath}`);

      const fs = await import('node:fs');
      if (fs.existsSync(distWasmPath)) {
        finalWasmPath = distWasmPath;
      } else if (fs.existsSync(publishedWasmPath)) {
        finalWasmPath = publishedWasmPath;
      } else if (fs.existsSync(nodeModulesWasmPath)) {
        finalWasmPath = nodeModulesWasmPath;
      } else {
        throw new Error(`WASM file not found at any of: ${distWasmPath}, ${publishedWasmPath}, ${nodeModulesWasmPath}`);
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

## File: src/pipeline/discover.ts
````typescript
import { globby } from 'globby';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import Ignore from 'ignore';
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
  return async ({ root, include, ignore, noGitignore = false }) => {
    try {
      if (!(await isDirectory(root))) {
        throw new FileSystemError('Root path is not a directory or does not exist', root);
      }
    } catch (e) {
      throw e;
    }
    const patterns = include && include.length > 0 ? [...include] : ['**/*'];
    
    // Use the ignore package for proper gitignore handling
    const ignoreFilter = Ignore();
    
    // Always ignore node_modules and .git
    ignoreFilter.add('**/node_modules/**');
    ignoreFilter.add('**/.git/**');
    ignoreFilter.add('.gitignore');
    
    // Add .gitignore patterns if not disabled
    if (!noGitignore) {
      let gitignoreContent = '';
      try {
        gitignoreContent = await readFile(path.join(root, '.gitignore'));
      } catch {
        // .gitignore is optional, so we can ignore errors here.
      }
      if (gitignoreContent) {
        ignoreFilter.add(gitignoreContent);
      }
    }
    
    // Add user-specified ignore patterns
    if (ignore && ignore.length > 0) {
      ignoreFilter.add(ignore.join('\n'));
    }

    // Use globby to find all files matching the include patterns.
    // Globby might return absolute paths if the patterns are absolute. We ensure
    // all paths are absolute first, then make them relative to the root for
    // consistent processing, which is required by the `ignore` package.
    const foundPaths = await globby(patterns, {
      cwd: root,
      gitignore: false, // We handle gitignore patterns manually
      dot: true,
      absolute: true,
      followSymbolicLinks: true,
      onlyFiles: true,
    });

    const relativePaths = foundPaths.map(p => path.relative(root, p).replace(/\\/g, '/'));

    // Filter out files that would cause symlink cycles
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
    
    // Filter the paths using the ignore package. Paths are now guaranteed to be relative.
    const filteredPaths = safeRelativePaths.filter(p => !ignoreFilter.ignores(p));

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

## File: src/pipeline/rank.ts
````typescript
import pagerank from 'graphology-pagerank';
import type { CodeGraph, Ranker, RankedCodeGraph } from '../types';
import Graph from 'graphology';
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

    // Pagerank lib requires a graphology instance.
    const simpleGraph = new Graph({ type: 'directed' });
    for (const [nodeId, node] of graph.nodes) {
      simpleGraph.addNode(nodeId, node);
    }
    for (const edge of graph.edges) {
      if (!simpleGraph.hasEdge(edge.fromId, edge.toId)) {
        simpleGraph.addDirectedEdge(edge.fromId, edge.toId);
      }
    }

    const graphForRank = simpleGraph;
    const ranksData = pagerank(graphForRank);
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

## File: package.json
````json
{
  "name": "repograph",
  "version": "0.1.17",
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
    "ignore": "^7.0.5",
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

## File: src/pipeline/analyze.ts
````typescript
import path from 'node:path';
import type { Analyzer, CodeNode, CodeEdge, FileContent, UnresolvedRelation } from '../types';
import { getLanguageConfigForFile, type LanguageConfig } from '../tree-sitter/language-config';
import { logger } from '../utils/logger.util';
import { ParserError } from '../utils/error.util';
import { fileURLToPath } from 'node:url';
import Tinypool from 'tinypool';
import processFileInWorker from './analyzer.worker';

const normalizePath = (p: string) => p.replace(/\\/g, '/');

// --- LANGUAGE-SPECIFIC IMPORT RESOLUTION LOGIC ---
// This part is needed on the main thread to resolve import paths.

const createModuleResolver = (extensions: string[]) => (fromFile: string, sourcePath: string, allFiles: string[]): string | null => {
  const basedir = normalizePath(path.dirname(fromFile));
  const importPath = normalizePath(path.join(basedir, sourcePath));

  // First, check if the path as-is (with extension) exists
  if (path.extname(importPath) && allFiles.includes(importPath)) {
    return importPath;
  }

  const parsedPath = path.parse(importPath);
  const basePath = normalizePath(path.join(parsedPath.dir, parsedPath.name));
  for (const ext of extensions) {
      const potentialFile = basePath + ext;
      if (allFiles.includes(potentialFile)) return potentialFile;
  }
  
  for (const ext of extensions) {
      const potentialIndexFile = normalizePath(path.join(importPath, 'index' + ext));
      if (allFiles.includes(potentialIndexFile)) return potentialIndexFile;
  }

  if (allFiles.includes(importPath)) return importPath;
  return null;      
};

const resolveImportFactory = (endings: string[], packageStyle: boolean = false) => (fromFile: string, sourcePath: string, allFiles: string[]): string | null => {
  const basedir = normalizePath(path.dirname(fromFile));
  const resolvedPathAsIs = normalizePath(path.join(basedir, sourcePath));
  if (allFiles.includes(resolvedPathAsIs)) return resolvedPathAsIs;

  const parsedSourcePath = path.parse(sourcePath);
  const basePath = normalizePath(path.join(basedir, parsedSourcePath.dir, parsedSourcePath.name));
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
    const resolvedPathAsIs = path.normalize(path.join(path.dirname(fromFile), sourcePath));
    return allFiles.includes(resolvedPathAsIs) ? resolvedPathAsIs : null;
  },
  typescript: createModuleResolver(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css']),
  javascript: createModuleResolver(['.js', 'jsx', '.mjs', '.cjs']),
  tsx: createModuleResolver(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css']),
  python: (fromFile: string, sourcePath: string, allFiles: string[]): string | null => {
    const basedir = normalizePath(path.dirname(fromFile));
    if (sourcePath.startsWith('.')) {
      const level = sourcePath.match(/^\.+/)?.[0]?.length ?? 0;
      const modulePath = sourcePath.substring(level).replace(/\./g, '/');
      let currentDir = basedir;
      for (let i = 1; i < level; i++) currentDir = path.dirname(currentDir);
      const targetPyFile = normalizePath(path.join(currentDir, modulePath) + '.py');
      if (allFiles.includes(targetPyFile)) return targetPyFile;
      const resolvedPath = normalizePath(path.join(currentDir, modulePath, '__init__.py'));
      if (allFiles.includes(resolvedPath)) return resolvedPath;
    }
    return resolveImportFactory(['.py', '/__init__.py'])(fromFile, sourcePath, allFiles);
  },
  java: resolveImportFactory(['.java'], true),
  csharp: resolveImportFactory(['.cs'], true),
  php: resolveImportFactory(['.php']),
  rust: (fromFile: string, sourcePath: string, allFiles: string[]): string | null => {
    const basedir = normalizePath(path.dirname(fromFile));
    const resolvedPath = normalizePath(path.join(basedir, sourcePath + '.rs'));
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
