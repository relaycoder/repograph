import path from 'node:path';
import { createParserForLanguage } from '../tree-sitter/languages.js';
import { getLanguageConfigForFile, type LanguageConfig } from '../tree-sitter/language-config.js';
import type { Analyzer, CodeNode, CodeNodeType, CodeNodeVisibility, FileContent, CodeEdge } from '../types.js';
import type { Node as TSNode, QueryCapture as TSMatch } from 'web-tree-sitter';
import { logger } from '../utils/logger.util.js';
import { ParserError } from '../utils/error.util.js';

// --- UTILITY FUNCTIONS ---

const getNodeText = (node: TSNode, content: string): string => content.slice(node.startIndex, node.endIndex);
const getLineFromIndex = (content: string, index: number): number => content.substring(0, index).split('\n').length;
const normalizePath = (p: string): string => p.replace(/\\/g, '/');

// --- LANGUAGE-SPECIFIC LOGIC ---

type LanguageHandler = {
  preProcessFile?: (file: FileContent, captures: TSMatch[]) => Record<string, any>;
  shouldSkipSymbol: (node: TSNode, symbolType: CodeNodeType, langName: string) => boolean;
  getSymbolNameNode: (declarationNode: TSNode, originalNode: TSNode) => TSNode | null;
  processComplexSymbol?: (context: ProcessSymbolContext) => boolean;
  parseParameters?: (paramsNode: TSNode, content: string) => { name: string; type?: string }[];
  resolveImport: (fromFile: string, importIdentifier: string, allFiles: string[]) => string | null;
};

type ProcessSymbolContext = {
  nodes: Map<string, CodeNode>;
  file: FileContent;
  node: TSNode;
  symbolType: CodeNodeType;
  processedSymbols: Set<string>;
  fileState: Record<string, any>;
};

const pythonHandler: Partial<LanguageHandler> = {
  getSymbolNameNode: (declarationNode: TSNode) => {
    if (declarationNode.type === 'expression_statement') {
      const assignmentNode = declarationNode.namedChild(0);
      if (assignmentNode?.type === 'assignment') {
        return assignmentNode.childForFieldName('left');
      }
    }
    return declarationNode.childForFieldName('name');
  },
};

const goLangHandler: Partial<LanguageHandler> = {
  getSymbolNameNode: (declarationNode: TSNode) => {
    const nodeType = declarationNode.type;
    if (['type_declaration', 'const_declaration', 'var_declaration'].includes(nodeType)) {
      const spec = declarationNode.namedChild(0);
      if (spec && ['type_spec', 'const_spec', 'var_spec'].includes(spec.type)) {
        return spec.childForFieldName('name');
      }
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
      if (declarator?.type === 'function_declarator') {
        return declarator.childForFieldName('declarator');
      }
      return declarator;
    }
    return declarationNode.childForFieldName('name');
  },
};

const tsLangHandler: Partial<LanguageHandler> = {
  preProcessFile: (_file, captures) => {
    const classNames = new Map<string, number>();
    const duplicateClassNames = new Set<string>();
    const seenClassNodes = new Set<number>();

    for (const { name, node } of captures) {
      if (name === 'class.definition') {
        let classNode = node.type === 'export_statement' ? (node.namedChildren[0] ?? node) : node;
        if (classNode.type === 'class_declaration' && !seenClassNodes.has(classNode.startIndex)) {
          seenClassNodes.add(classNode.startIndex);
          const nameNode = classNode.childForFieldName('name');
          if (nameNode) {
            const className = nameNode.text;
            const count = classNames.get(className) || 0;
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
    return (symbolType === 'field' && node.type === 'public_field_definition') ||
      (symbolType === 'variable' && node.type === 'variable_declarator');
  },
  getSymbolNameNode: (declarationNode, originalNode) => {
    if (originalNode.type === 'variable_declarator' || originalNode.type === 'public_field_definition') { // Arrow function
      return originalNode.childForFieldName('name');
    }
    if (declarationNode.type === 'export_statement') {
      const lexicalDecl = declarationNode.namedChildren[0];
      if (lexicalDecl?.type === 'lexical_declaration') {
        const varDeclarator = lexicalDecl.namedChildren[0];
        if (varDeclarator?.type === 'variable_declarator') {
          return varDeclarator.childForFieldName('name');
        }
      }
    }
    return declarationNode.childForFieldName('name');
  },
  processComplexSymbol: ({ nodes, file, node, symbolType, processedSymbols, fileState }) => {
    if (symbolType !== 'method' && symbolType !== 'field') return false;
    const classParent = node.parent?.parent; // class_body -> class_declaration
    if (classParent?.type === 'class_declaration') {
      const classNameNode = classParent.childForFieldName('name');
      if (classNameNode) {
        const className = classNameNode.text;
        const nameNode = node.childForFieldName('name');
        // The check for duplicateClassNames is important to avoid ambiguity.
        // We remove the dependency on checking if the class has been processed first,
        // because the order of captures from tree-sitter is not guaranteed to be in source order.
        // This makes the analysis more robust.
        if (nameNode && !fileState['duplicateClassNames']?.has(className)) {
          const methodName = nameNode.text;
          const symbolName = `${className}.${methodName}`;
          const symbolId = `${file.path}#${symbolName}`;
          if (!processedSymbols.has(symbolId) && !nodes.has(symbolId)) {
            processedSymbols.add(symbolId);
            nodes.set(symbolId, {
              id: symbolId, type: symbolType, name: symbolName, filePath: file.path,
              startLine: getLineFromIndex(file.content, node.startIndex),
              endLine: getLineFromIndex(file.content, node.endIndex),
              codeSnippet: node.text?.split('{')[0]?.trim() || '',
            });
          }
        }
      }
    }
    return false;
  },
  parseParameters: (paramsNode: TSNode, content: string): { name: string; type?: string }[] => {
    const params: { name: string; type?: string }[] = [];
    // For TS, formal_parameters has required_parameter, optional_parameter children.
    for (const child of paramsNode.namedChildren) {
      if (child && (child.type === 'required_parameter' || child.type === 'optional_parameter')) {
        const nameNode = child.childForFieldName('pattern');
        const typeNode = child.childForFieldName('type');
        if (nameNode) {
          params.push({
            name: getNodeText(nameNode, content),
            type: typeNode ? getNodeText(typeNode, content).replace(/^:\s*/, '') : undefined,
          });
        }
      }
    }
    return params;
  },
};

const createModuleResolver = (extensions: string[]) => (fromFile: string, sourcePath: string, allFiles: string[]): string | null => {
  const basedir = normalizePath(path.dirname(fromFile));
  const importPath = normalizePath(path.join(basedir, sourcePath));

  // Case 1: Path needs an extension or has the wrong one (e.g., .js for .ts)
  const parsedPath = path.parse(importPath);
  const basePath = normalizePath(path.join(parsedPath.dir, parsedPath.name));
  for (const ext of extensions) {
      const potentialFile = basePath + ext;
      if (allFiles.includes(potentialFile)) {
          return potentialFile;
      }
  }
  
  // Case 2: Path is a directory with an index file
  for (const ext of extensions) {
      const potentialIndexFile = normalizePath(path.join(importPath, 'index' + ext));
      if (allFiles.includes(potentialIndexFile)) {
          return potentialIndexFile;
      }
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

const phpHandler: Partial<LanguageHandler> = {
  getSymbolNameNode: (declarationNode: TSNode) => {
    if (declarationNode.type === 'namespace_definition') {
      // For namespace definitions, get the namespace name node
      const nameNode = declarationNode.childForFieldName('name');
      return nameNode;
    }
    return declarationNode.childForFieldName('name');
  },
};

const languageHandlers: Record<string, Partial<LanguageHandler>> = {
  default: {
    shouldSkipSymbol: () => false,
    getSymbolNameNode: (declarationNode) => declarationNode.childForFieldName('name'),
    resolveImport: (fromFile, sourcePath, allFiles) => {
      const resolvedPathAsIs = path.normalize(path.join(path.dirname(fromFile), sourcePath));
      return allFiles.includes(resolvedPathAsIs) ? resolvedPathAsIs : null;
    }
  },
  typescript: {
    ...tsLangHandler,
    resolveImport: createModuleResolver(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']),
  },
  javascript: {
    resolveImport: createModuleResolver(['.js', '.jsx', '.mjs', '.cjs']),
  },
  tsx: {
    ...tsLangHandler,
    resolveImport: createModuleResolver(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']),
  },
  python: { 
    ...pythonHandler, 
    resolveImport: (fromFile: string, sourcePath: string, allFiles: string[]): string | null => {
      const basedir = normalizePath(path.dirname(fromFile));

      // Handle relative imports (starting with .)
      if (sourcePath.startsWith('.')) {
        const dots = sourcePath.match(/^\.+/)?.[0] ?? '';
        const level = dots.length;
        const modulePath = sourcePath.substring(level).replace(/\./g, '/');

        let currentDir = basedir;
        for (let i = 1; i < level; i++) {
          currentDir = path.dirname(currentDir);
        }

        const targetPyFile = normalizePath(path.join(currentDir, modulePath) + '.py');
        if (allFiles.includes(targetPyFile)) return targetPyFile;
        
        const resolvedPath = normalizePath(path.join(currentDir, modulePath, '__init__.py'));
        if (allFiles.includes(resolvedPath)) return resolvedPath;
      }
      
      // Handle absolute imports
      return resolveImportFactory(['.py', '/__init__.py'])(fromFile, sourcePath, allFiles);
    }
  },
  java: { resolveImport: resolveImportFactory(['.java'], true) },
  csharp: { resolveImport: resolveImportFactory(['.cs'], true) },
  php: { ...phpHandler, resolveImport: resolveImportFactory(['.php']) },
  go: goLangHandler,
  rust: {
    ...goLangHandler,
    resolveImport: (fromFile: string, sourcePath: string, allFiles: string[]): string | null => {
      const basedir = normalizePath(path.dirname(fromFile));
      
      // Handle module paths like "utils" -> "utils.rs"
      const resolvedPath = normalizePath(path.join(basedir, sourcePath + '.rs'));
      if (allFiles.includes(resolvedPath)) return resolvedPath;
      
      // Handle mod.rs style imports
      return resolveImportFactory(['.rs', '/mod.rs'])(fromFile, sourcePath, allFiles);
    }
  },
  c: cLangHandler,
  cpp: cLangHandler,
};

const getLangHandler = (langName: string): LanguageHandler => ({
  ...languageHandlers['default'],
  ...languageHandlers[langName],
} as LanguageHandler);


/**
 * Creates the default Tree-sitter based analyzer. It parses files to find
 * symbols (nodes) and their relationships (edges), constructing a CodeGraph.
 * Supports multiple programming languages.
 * @returns An Analyzer function.
 */
export const createTreeSitterAnalyzer = (): Analyzer => {
  return async (files: readonly FileContent[]) => {
    const nodes = new Map<string, CodeNode>();
    const edges: CodeEdge[] = [];
    const allFilePaths = files.map(f => normalizePath(f.path));

    // Phase 1: Add all files as nodes
    for (const file of files) {
      const langConfig = getLanguageConfigForFile(normalizePath(file.path));
      nodes.set(file.path, {
        id: file.path, type: 'file', name: path.basename(file.path),
        filePath: file.path, startLine: 1, endLine: file.content.split('\n').length,
        language: langConfig?.name,
      });
    }

    // Phase 2: Group files by language
    const filesByLanguage = files.reduce((acc, file) => {
      const langConfig = getLanguageConfigForFile(normalizePath(file.path));
      if (langConfig) {
        if (!acc.has(langConfig.name)) acc.set(langConfig.name, []);
        acc.get(langConfig.name)!.push(file);
      }
      return acc;
    }, new Map<string, FileContent[]>());

    // Phase 3: Parse all files once
    const fileParseData = new Map<string, { file: FileContent; captures: TSMatch[]; langConfig: LanguageConfig }>();
    for (const [langName, langFiles] of filesByLanguage.entries()) {
      const langConfig = getLanguageConfigForFile(normalizePath(langFiles[0]!.path));
      if (!langConfig) continue;
      try {
        const parser = await createParserForLanguage(langConfig);
        if (!parser.language) continue;
        const query = new (await import('web-tree-sitter')).Query(parser.language, langConfig.query);
        for (const file of langFiles) {
          const tree = parser.parse(file.content);
          if (tree) fileParseData.set(file.path, { file, captures: query.captures(tree.rootNode), langConfig });
        }
      } catch (error) {
        logger.warn(new ParserError(`Failed to process ${langName} files`, langName, error));
        // Continue processing other languages, don't let one language failure stop the entire analysis
        continue;
      }
    }

    // Phase 4: Process definitions for all files
    for (const { file, captures, langConfig } of fileParseData.values()) {
      processFileDefinitions({ nodes }, { ...file, path: normalizePath(file.path) }, captures, langConfig);
    }
    
    // Phase 5: Process relationships for all files
    const resolver = new SymbolResolver(nodes, edges);
    for (const { file, captures, langConfig } of fileParseData.values()) {
      processFileRelationships({ nodes, edges }, { ...file, path: normalizePath(file.path) }, captures, langConfig, resolver, allFilePaths);
    }

    return { nodes: Object.freeze(nodes), edges: Object.freeze(edges) };
  };
};

/**
 * Process symbol definitions for a single file.
 */
function processFileDefinitions(
  graph: { nodes: Map<string, CodeNode> },
  file: FileContent,
  captures: TSMatch[],
  langConfig: LanguageConfig
): void {
  
  const handler = getLangHandler(langConfig.name);
  const fileState = handler.preProcessFile?.(file, captures) || {};
  const processedSymbols = new Set<string>();

  
  const definitionCaptures = captures.filter(({ name }) => name.endsWith('.definition'));
  const otherCaptures = captures.filter(({ name }) => !name.endsWith('.definition'));

  for (const { name, node } of definitionCaptures) {
    const parts = name.split('.');
    const type = parts.slice(0, -1).join('.');
    const symbolType = getSymbolTypeFromCapture(name, type);
    if (!symbolType) continue;

    const childCaptures = otherCaptures.filter(
      (c) => c.node.startIndex >= node.startIndex && c.node.endIndex <= node.endIndex
    );

    processSymbol(
      { ...graph, file, node, symbolType, processedSymbols, fileState },
      langConfig
,
      childCaptures
    );
  }
}

/**
 * Process a single symbol definition.
 */
function processSymbol(
  context: ProcessSymbolContext,
  langConfig: LanguageConfig,
  childCaptures: TSMatch[]
): void {
  const { nodes, file, node, symbolType, processedSymbols } = context;
  const handler = getLangHandler(langConfig.name);

  if (handler.shouldSkipSymbol(node, symbolType, langConfig.name)) return;
  if (handler.processComplexSymbol?.(context)) return;

  let declarationNode = node;
  if (node.type === 'export_statement' && node.namedChildCount > 0) {
    declarationNode = node.namedChildren[0] ?? node;
  }
  
  const nameNode = handler.getSymbolNameNode(declarationNode, node);
  if (!nameNode) return;

  const symbolName = nameNode.text;
  const symbolId = `${file.path}#${symbolName}`;

  if (symbolName && !processedSymbols.has(symbolId) && !nodes.has(symbolId)) {
    processedSymbols.add(symbolId);

    // --- NEW LOGIC TO EXTRACT QUALIFIERS ---
    const qualifiers: { [key: string]: TSNode } = {};
    for (const capture of childCaptures) {
      qualifiers[capture.name] = capture.node;
    }

    const visibilityNode = qualifiers['qualifier.visibility'];
    const visibility = visibilityNode
      ? (getNodeText(visibilityNode, file.content) as CodeNodeVisibility)
      : undefined;

    const parametersNode = qualifiers['symbol.parameters'];
    const parameters =
      parametersNode && handler.parseParameters
        ? handler.parseParameters(parametersNode, file.content)
        : undefined;

    const returnTypeNode = qualifiers['symbol.returnType'];
    const returnType = returnTypeNode ? getNodeText(returnTypeNode, file.content).replace(/^:\s*/, '') : undefined;

    nodes.set(symbolId, {
      id: symbolId, type: symbolType, name: symbolName, filePath: file.path,
      startLine: getLineFromIndex(file.content, node.startIndex),
      endLine: getLineFromIndex(file.content, node.endIndex),
      codeSnippet: node.text?.split('{')[0]?.trim() || '',
      ...(qualifiers['qualifier.async'] && { isAsync: true }),
      ...(qualifiers['qualifier.static'] && { isStatic: true }),
      ...(visibility && { visibility }),
      ...(returnType && { returnType }),
      ...(parameters && { parameters }),
    });
  }
}

/**
 * Process relationships (imports, calls, inheritance) for a single file.
 */
function processFileRelationships(
  graph: { nodes: Map<string, CodeNode>, edges: CodeEdge[] },
  file: FileContent,
  captures: TSMatch[],
  langConfig: LanguageConfig,
  resolver: SymbolResolver,
  allFilePaths: string[]
): void {
  const handler = getLangHandler(langConfig.name);
  for (const { name, node } of captures) {
    const parts = name.split('.');
    const type = parts.slice(0, -1).join('.');
    const subtype = parts[parts.length - 1];

    if (type === 'import' && subtype === 'source') {
      const importIdentifier = getNodeText(node, file.content).replace(/['"`]/g, '');
      const importedFilePath = handler.resolveImport(file.path, importIdentifier, allFilePaths);
      if (importedFilePath && graph.nodes.has(importedFilePath)) {
        const edge: CodeEdge = { fromId: file.path, toId: importedFilePath, type: 'imports' };
        if (!graph.edges.some(e => e.fromId === edge.fromId && e.toId === edge.toId)) {
          graph.edges.push(edge);
        }
      }
      continue;
    }

    if (subtype && ['inheritance', 'implementation', 'call'].includes(subtype)) {
      const fromId = findEnclosingSymbolId(node, file, graph.nodes);
      if (!fromId) continue;
      const toName = getNodeText(node, file.content).replace(/<.*>$/, '');
      const toNode = resolver.resolve(toName, file.path);
      if (!toNode) continue;
      
      const edgeType = subtype === 'inheritance' ? 'inherits' : subtype === 'implementation' ? 'implements' : 'calls';
      const edge: CodeEdge = { fromId, toId: toNode.id, type: edgeType };
      if (!graph.edges.some(e => e.fromId === edge.fromId && e.toId === edge.toId)) {
        graph.edges.push(edge);
      }
    }
  }
}

/**
 * Get symbol type from capture name and language.
 */
function getSymbolTypeFromCapture(captureName: string, type: string): CodeNodeType | null {
  const baseMap = new Map<string, CodeNodeType>([
    ['class', 'class'],
    ['function', 'function'],
    ['function.arrow', 'arrow_function'],
    ['interface', 'interface'],
    ['type', 'type'],
    ['method', 'method'],
    ['field', 'field'],
    ['struct', 'struct'],
    ['enum', 'enum'],
    ['namespace', 'namespace'],
    ['trait', 'trait'],
    ['impl', 'impl'],
    ['constructor', 'constructor'],
    ['property', 'property'],
    ['variable', 'variable'],
    ['constant', 'constant'],
    ['static', 'static'],
    ['union', 'union'],
    ['template', 'template'],
  ]);
  return baseMap.get(captureName) ?? baseMap.get(type) ?? null;
}

/**
 * A best-effort symbol resolver to find the ID of a referenced symbol.
 */
class SymbolResolver {
  constructor(
    private nodes: ReadonlyMap<string, CodeNode>,
    private edges: readonly CodeEdge[],
  ) {}

  resolve(symbolName: string, contextFile: string): CodeNode | null {
    const sameFileId = `${contextFile}#${symbolName}`;
    if (this.nodes.has(sameFileId)) return this.nodes.get(sameFileId)!;

    const importedFiles = this.edges.filter(e => e.fromId === contextFile && e.type === 'imports').map(e => e.toId);
    for (const file of importedFiles) {
      const importedId = `${file}#${symbolName}`;
      if (this.nodes.has(importedId)) return this.nodes.get(importedId)!;
    }

    for (const node of this.nodes.values()) {
      if (node.name === symbolName && ['class', 'function', 'interface', 'struct', 'type', 'enum'].includes(node.type)) {
        return node;
      }
    }
    return null;
  }
}

/**
 * Traverses up the AST from a start node to find the enclosing symbol definition
 * and returns its unique ID.
 */
function findEnclosingSymbolId(startNode: TSNode, file: FileContent, nodes: ReadonlyMap<string, CodeNode>): string | null {
  let current: TSNode | null = startNode.parent;
  while (current) {
    const nameNode = current.childForFieldName('name');
    if (nameNode) {
      let symbolName = nameNode.text;
      if (current.type === 'method_definition' || (current.type === 'public_field_definition' && !current.text.includes('=>'))) {
        const classNode = current.parent?.parent; // class_body -> class_declaration
        if (classNode?.type === 'class_declaration') {
          symbolName = `${classNode.childForFieldName('name')?.text}.${symbolName}`;
        }
      }
      const symbolId = `${file.path}#${symbolName}`;
      if (nodes.has(symbolId)) return symbolId;
    }
    current = current.parent;
  }
  return file.path; // Fallback to file node
}