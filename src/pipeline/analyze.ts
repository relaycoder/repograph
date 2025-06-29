import path from 'node:path';
import { createParserForLanguage } from '../tree-sitter/languages.js';
import { getLanguageConfigForFile } from '../tree-sitter/language-config.js';
import type { Analyzer, CodeNode, CodeNodeType, FileContent, CodeEdge } from '../types.js';

export const getNodeText = (node: import('web-tree-sitter').Node, content: string): string => {
  return content.slice(node.startIndex, node.endIndex);
};

const getLineFromIndex = (content: string, index: number): number => {
  return content.substring(0, index).split('\n').length;
};


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

    // Phase 1: Add all files as nodes
    for (const file of files) {
      const fileId = file.path;
      if (!nodes.has(fileId)) {
        nodes.set(fileId, {
          id: fileId,
          type: 'file',
          name: path.basename(file.path),
          filePath: file.path,
          startLine: 1,
          endLine: file.content.split('\n').length,
        });
      }
    }

    // Phase 2: Group files by language and process each group
    const filesByLanguage = new Map<string, FileContent[]>();
    const unsupportedFiles: FileContent[] = [];

    for (const file of files) {
      const languageConfig = getLanguageConfigForFile(file.path);
      if (languageConfig) {
        if (!filesByLanguage.has(languageConfig.name)) {
          filesByLanguage.set(languageConfig.name, []);
        }
        filesByLanguage.get(languageConfig.name)!.push(file);
      } else {
        unsupportedFiles.push(file);
      }
    }

    // Log unsupported files for debugging
    if (unsupportedFiles.length > 0) {
      console.log(`Skipping ${unsupportedFiles.length} unsupported files:`, 
        unsupportedFiles.map(f => f.path).slice(0, 5).join(', ') + 
        (unsupportedFiles.length > 5 ? '...' : ''));
    }

    // Phase 3: Process definitions for all language groups
    for (const [languageName, languageFiles] of filesByLanguage) {
      const languageConfig = getLanguageConfigForFile(languageFiles[0]!.path);
      if (!languageConfig) continue;

      try {
        const parser = await createParserForLanguage(languageConfig);
        await processDefinitionsForLanguage({ nodes, edges }, languageFiles, parser, languageConfig);
      } catch (error) {
        console.warn(`Failed to process ${languageName} files:`, error);
      }
    }

    // Phase 4: Process relationships for all language groups
    const resolver = new SymbolResolver(nodes, edges);
    for (const [languageName, languageFiles] of filesByLanguage) {
        const languageConfig = getLanguageConfigForFile(languageFiles[0]!.path);
        if (!languageConfig) continue;

        try {
          const parser = await createParserForLanguage(languageConfig);
          await processRelationshipsForLanguage({ nodes, edges }, languageFiles, parser, languageConfig, resolver);
        } catch (error) {
          console.warn(`Failed to process relationships for ${languageName} files:`, error);
        }
    }

    return { nodes: Object.freeze(nodes), edges: Object.freeze(edges) };
  };
};

/**
 * PHASE 3: Process symbol definitions for a set of files of the same language.
 */
async function processDefinitionsForLanguage(
  graph: { nodes: Map<string, CodeNode>, edges: CodeEdge[] },
  files: FileContent[],
  parser: import('web-tree-sitter').Parser,
  languageConfig: import('../tree-sitter/language-config.js').LanguageConfig
): Promise<void> {
  if (!parser.language) {
    console.warn(`No language available for parser in ${languageConfig.name}. Skipping file processing.`);
    return;
  }
  const query = new (await import('web-tree-sitter')).Query(parser.language, languageConfig.query);
  
  for (const file of files) {
    const tree = parser.parse(file.content);
    if (!tree) continue;
    const captures = query.captures(tree.rootNode);

    const processedSymbols = new Set<string>();
    const processedClassNodes = new Set<number>();
    const duplicateClassNames = new Set<string>();

    // First pass: identify duplicate class names (mainly for TypeScript/Java/C#)
    if (languageConfig.name === 'typescript' || languageConfig.name === 'java' || languageConfig.name === 'csharp') {
      const seenClassNodes = new Set<number>();
      const classNames = new Map<string, number>();
      
      for (const { name, node } of captures) {
        const parts = name.split('.');
        const type = parts.slice(0, -1).join('.');
        const subtype = parts[parts.length - 1];
        
        if (subtype === 'definition' && type === 'class') {
          let classNode = node;
          if (classNode.type === 'export_statement') {
            classNode = classNode.namedChildren[0] ?? classNode;
          }
          if (classNode.type === 'class_declaration') {
            if (seenClassNodes.has(classNode.startIndex)) {
              continue;
            }
            seenClassNodes.add(classNode.startIndex);
            
            const nameNode = classNode.childForFieldName('name');
            if (nameNode) {
              const className = nameNode.text;
              const symbolId = `${file.path}#${className}`;
              const count = classNames.get(symbolId) || 0;
              classNames.set(symbolId, count + 1);
              if (count + 1 > 1) {
                duplicateClassNames.add(className);
              }
            }
          }
        }
      }
    }

    // Second pass: process symbol definitions
    for (const { name, node } of captures) {
      const parts = name.split('.');
      const subtype = parts[parts.length - 1];

      if (subtype !== 'definition') continue;

      const type = parts.slice(0, -1).join('.');
      const symbolType = getSymbolTypeFromCapture(name, type);
      if (!symbolType) continue;

      await processSymbol(
        graph.nodes,
        file,
        node,
        symbolType,
        processedSymbols,
        processedClassNodes,
        duplicateClassNames,
        languageConfig
      );
    }
  }
}

/**
 * PHASE 4: Process relationships (imports, calls, inheritance) for a set of files.
 */
async function processRelationshipsForLanguage(
  graph: { nodes: Map<string, CodeNode>, edges: CodeEdge[] },
  files: FileContent[],
  parser: import('web-tree-sitter').Parser,
  languageConfig: import('../tree-sitter/language-config.js').LanguageConfig,
  resolver: SymbolResolver
): Promise<void> {
  if (!parser.language) {
    console.warn(`No language available for parser in ${languageConfig.name}. Skipping relationship processing.`);
    return;
  }
  const query = new (await import('web-tree-sitter')).Query(parser.language, languageConfig.query);
  
  for (const file of files) {
    const tree = parser.parse(file.content);
    if (!tree) {
      continue; // Skip files that couldn't be parsed
    }
    const captures = query.captures(tree.rootNode);

    for (const { name, node } of captures) {
      const parts = name.split('.');
      const type = parts.slice(0, -1).join('.');
      const subtype = parts[parts.length - 1];

      // Handle imports
      if (type === 'import' && subtype === 'source') {
        const allFilePaths = [...graph.nodes.keys()].filter(k => graph.nodes.get(k)?.type === 'file');
        const importedFilePath = resolveImportPath(
          file.path,
          getNodeText(node, file.content),
          languageConfig.name,
          allFilePaths
        );
        if (importedFilePath && graph.nodes.has(importedFilePath)) {
            const edge: CodeEdge = { fromId: file.path, toId: importedFilePath, type: 'imports' };
            if (!graph.edges.some(e => e.fromId === edge.fromId && e.toId === edge.toId && e.type === edge.type)) {
                graph.edges.push(edge);
            }
        }
        continue;
      }

      // Handle other relationships (inheritance, implementation, calls)
      if (subtype && ['inheritance', 'implementation', 'call'].includes(subtype)) {
        const fromId = findEnclosingSymbolId(node, file, graph.nodes);
        if (!fromId) continue;

        const toName = getNodeText(node, file.content).replace(/<.*>$/, ''); // a.b.c<T> -> a.b.c
        const toNode = resolver.resolve(toName, file.path);
        if (!toNode) continue;

        const edgeType = subtype === 'inheritance' ? 'inherits' : subtype === 'implementation' ? 'implements' : 'calls';
        const edge: CodeEdge = { fromId, toId: toNode.id, type: edgeType };

        if (!graph.edges.some(e => e.fromId === edge.fromId && e.toId === edge.toId && e.type === edge.type)) {
            graph.edges.push(edge);
        }
      }
    }
  }
}

function resolveImportPath(
  fromFile: string,
  importIdentifier: string,
  language: string,
  allFiles: string[]
): string | null {
  const sourcePath = importIdentifier.replace(/['"`]/g, '');

  const potentialEndings: Record<string, string[]> = {
    typescript: ['.ts', '.tsx', '/index.ts', '/index.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    javascript: ['.js', '.jsx', '/index.js', '/index.jsx', '.mjs', '.cjs'],
    python: ['.py', '/__init__.py'],
    java: ['.java'],
    c: ['.h', '.c'],
    cpp: ['.hpp', '.h', '.cpp', '.cc', '.cxx'],
    csharp: ['.cs'],
    go: ['.go'],
    rust: ['.rs', '/mod.rs'],
  };
  const basedir = path.dirname(fromFile);
  const endings = potentialEndings[language] || [];

  // 1. Try resolving path as is (e.g. './foo.js' might exist)
  const resolvedPathAsIs = path.normalize(path.join(basedir, sourcePath));
  if (allFiles.includes(resolvedPathAsIs)) {
    return resolvedPathAsIs;
  }

  // 2. Try resolving by changing/adding extensions
  const parsedSourcePath = path.parse(sourcePath);
  const basePath = path.normalize(path.join(basedir, parsedSourcePath.dir, parsedSourcePath.name));

  for (const end of endings) {
    if (allFiles.includes(basePath + end)) return basePath + end;
  }

  // 3. Handle Java/C# package-style imports (e.g., com.package.Class)
  if ((language === 'java' || language === 'csharp') && sourcePath.includes('.')) {
    const packagePath = sourcePath.replace(/\./g, '/');
    for (const end of endings) {
      const fileFromRoot = packagePath + end;
      if (allFiles.includes(fileFromRoot)) return fileFromRoot;
    }
  }

  // Note: This is a simplified resolver. A full implementation would need to handle:
  // - tsconfig.json paths for TypeScript
  // - package.json dependencies / node_modules
  // - GOPATH / Go modules
  // - Maven/Gradle source sets for Java, etc.
  return null;
}

/**
 * Get symbol type from capture name and language
 */
function getSymbolTypeFromCapture(
  captureName: string,
  type: string
): CodeNodeType | null {
  // Base mapping that works for most languages
  const baseMap: Record<string, CodeNodeType> = {
    class: 'class',
    function: 'function',
    'function.arrow': 'arrow_function',
    interface: 'interface',
    type: 'type',
    method: 'method',
    field: 'field',
    struct: 'struct',
    enum: 'enum',
    namespace: 'namespace',
    trait: 'trait',
    impl: 'impl',
    constructor: 'constructor',
    property: 'property',
    variable: 'variable',
    constant: 'constant',
    static: 'static',
    union: 'union',
    template: 'template',
  };

  // Try the full capture name first, then the type part
  return baseMap[captureName] || baseMap[type] || null;
}

/**
 * Process a symbol definition
 */
async function processSymbol(
  nodes: Map<string, CodeNode>,
  file: FileContent,
  node: import('web-tree-sitter').Node,
  symbolType: CodeNodeType,
  processedSymbols: Set<string>,
  processedClassNodes: Set<number>,
  duplicateClassNames: Set<string>,
  languageConfig: import('../tree-sitter/language-config.js').LanguageConfig
): Promise<void> {
  // Skip field definitions that are actually arrow functions (TypeScript specific)
  if (languageConfig.name === 'typescript' && symbolType === 'field' && node.type === 'public_field_definition') {
    const valueNode = node.childForFieldName('value');
    if (valueNode && valueNode.type === 'arrow_function') {
      return;
    }
  }
  
  // Skip variable declarations that are actually arrow functions (TypeScript specific)
  if (languageConfig.name === 'typescript' && symbolType === 'variable' && node.type === 'variable_declarator') {
    const valueNode = node.childForFieldName('value');
    if (valueNode && valueNode.type === 'arrow_function') {
      return; // Skip this, it will be handled by the arrow function capture
    }
  }

  let declarationNode = node;
  let nameNode: import('web-tree-sitter').Node | null = null;
  
  // Handle different node structures based on symbol type and language
  if (languageConfig.name === 'typescript' && (symbolType === 'method' || symbolType === 'field')) {
    // TypeScript-specific method/field handling
    const result = processTypeScriptMethodOrField(
      nodes, file, node, symbolType, processedSymbols, processedClassNodes, duplicateClassNames
    );
    if (result) return; // Successfully processed or should skip
  } else if (languageConfig.name === 'typescript' && symbolType === 'arrow_function') {
    // TypeScript-specific arrow function handling
    nameNode = await getTypeScriptArrowFunctionName(declarationNode);
  } else {
    // Generic handling for most languages
    if (declarationNode.type === 'export_statement') {
      declarationNode = declarationNode.namedChildren[0] ?? declarationNode;
    }
    
    // Handle language-specific name extraction
    if (languageConfig.name === 'go') {
      nameNode = getGoSymbolName(declarationNode);
    } else if (languageConfig.name === 'c' || languageConfig.name === 'cpp') {
      nameNode = getCSymbolName(declarationNode);
    } else {
      nameNode = declarationNode.childForFieldName('name');
    }
  }

  if (nameNode) {
    const symbolName = nameNode.text;
    const symbolId = `${file.path}#${symbolName}`;
    
    if (symbolName && !processedSymbols.has(symbolId) && !nodes.has(symbolId)) {
      processedSymbols.add(symbolId);
      
      // Track processed class nodes
      if (symbolType === 'class') {
        let classNode = declarationNode;
        if (classNode.type === 'export_statement') {
          classNode = classNode.namedChildren[0] ?? classNode;
        }
        if (classNode.type === 'class_declaration') {
          processedClassNodes.add(classNode.startIndex);
        }
      }
      
      nodes.set(symbolId, {
        id: symbolId, 
        type: symbolType, 
        name: symbolName, 
        filePath: file.path,
        startLine: getLineFromIndex(file.content, node.startIndex),
        endLine: getLineFromIndex(file.content, node.endIndex),
        codeSnippet: node.text?.split('{')[0]?.trim() || '',
      });
    }
  }
}

/**
 * TypeScript-specific method/field processing
 */
function processTypeScriptMethodOrField(
  nodes: Map<string, CodeNode>,
  file: FileContent,
  node: import('web-tree-sitter').Node,
  symbolType: CodeNodeType,
  processedSymbols: Set<string>,
  processedClassNodes: Set<number>,
  duplicateClassNames: Set<string>
): boolean {
  let parent = node.parent;
  while (parent && parent.type !== 'class_body') {
    parent = parent.parent;
  }
  if (parent) {
    const classParent = parent.parent;
    if (classParent && classParent.type === 'class_declaration') {
      const classNameNode = classParent.childForFieldName('name');
      if (classNameNode) {
        const className = classNameNode.text;
        
        if (processedClassNodes.has(classParent.startIndex) && !duplicateClassNames.has(className)) {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
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
    }
  }
  return true; // Processed or should skip
}

/**
 * TypeScript-specific arrow function name extraction
 */
async function getTypeScriptArrowFunctionName(
  declarationNode: import('web-tree-sitter').Node
): Promise<import('web-tree-sitter').Node | null> {
  if (declarationNode.type === 'export_statement') {
    const lexicalDecl = declarationNode.namedChildren[0];
    if (lexicalDecl?.type === 'lexical_declaration') {
      const variableDeclarator = lexicalDecl.namedChildren[0];
      if (variableDeclarator?.type === 'variable_declarator') {
        return variableDeclarator.childForFieldName('name');
      }
    }
  } else if (declarationNode.type === 'variable_declarator') {
    return declarationNode.childForFieldName('name');
  } else if (declarationNode.type === 'public_field_definition') {
    return declarationNode.childForFieldName('name');
  }
  return null;
}

/**
 * Go-specific symbol name extraction
 */
function getGoSymbolName(
  declarationNode: import('web-tree-sitter').Node
): import('web-tree-sitter').Node | null {
  // For Go type_declaration, the name is in type_spec child
  if (declarationNode.type === 'type_declaration') {
    const typeSpec = declarationNode.namedChild(0);
    if (typeSpec?.type === 'type_spec') {
      return typeSpec.childForFieldName('name');
    }
  }
  
  // For Go const_declaration, the name is in const_spec child
  if (declarationNode.type === 'const_declaration') {
    const constSpec = declarationNode.namedChild(0);
    if (constSpec?.type === 'const_spec') {
      return constSpec.childForFieldName('name');
    }
  }
  
  // For Go var_declaration, the name is in var_spec child
  if (declarationNode.type === 'var_declaration') {
    const varSpec = declarationNode.namedChild(0);
    if (varSpec?.type === 'var_spec') {
      return varSpec.childForFieldName('name');
    }
  }
  
  // For other Go nodes, try the standard approach
  return declarationNode.childForFieldName('name');
}

/**
 * C/C++-specific symbol name extraction
 */
function getCSymbolName(
  declarationNode: import('web-tree-sitter').Node
): import('web-tree-sitter').Node | null {
  // For typedef (type_definition), the name is usually the last child
  if (declarationNode.type === 'type_definition') {
    const lastChild = declarationNode.namedChild(declarationNode.namedChildCount - 1);
    if (lastChild?.type === 'type_identifier') {
      return lastChild;
    }
  }
  
  // For function_definition, the name is in the declarator
  if (declarationNode.type === 'function_definition') {
    const declarator = declarationNode.childForFieldName('declarator');
    if (declarator?.type === 'function_declarator') {
      const nameNode = declarator.childForFieldName('declarator');
      if (nameNode?.type === 'identifier') {
        return nameNode;
      }
    }
  }
  
  // For struct/union/enum, try the standard approach
  return declarationNode.childForFieldName('name');
}

/**
 * A best-effort symbol resolver to find the ID of a referenced symbol.
 */
class SymbolResolver {
  constructor(
    private nodes: ReadonlyMap<string, CodeNode>,
    private edges: readonly CodeEdge[],
  ) {}

  /**
   * Resolves a symbol name to a CodeNode.
   * @param symbolName The name of the symbol to resolve (e.g., "MyClass").
   * @param contextFile The path of the file where the reference occurs.
   * @returns The resolved CodeNode or null.
   */
  resolve(
    symbolName: string,
    contextFile: string,
  ): CodeNode | null {
    // 1. Check for definition in the same file.
    // This is a simplified check. It won't find nested symbols correctly without more context.
    const sameFileId = `${contextFile}#${symbolName}`;
    if (this.nodes.has(sameFileId)) {
      return this.nodes.get(sameFileId)!;
    }

    // 2. Check in imported files.
    const importedFiles = this.edges
      .filter(e => e.fromId === contextFile && e.type === 'imports')
      .map(e => e.toId);
    
    for (const file of importedFiles) {
      const importedId = `${file}#${symbolName}`;
      if (this.nodes.has(importedId)) {
        return this.nodes.get(importedId)!;
      }
    }

    // 3. Fallback: search all files (might be ambiguous).
    for (const node of this.nodes.values()) {
      if (node.name === symbolName) {
        // To reduce ambiguity, prefer non-method symbols.
        if (['class', 'function', 'interface', 'struct', 'type', 'enum'].includes(node.type)) {
          return node;
        }
      }
    }

    return null;
  }
}

/**
 * Traverses up the AST from a start node to find the enclosing symbol definition
 * and returns its unique ID.
 * @param startNode The node to start traversal from.
 * @param file The file content object.
 * @param nodes The map of all code nodes.
 * @returns The unique ID of the enclosing symbol, or the file path as a fallback.
 */
function findEnclosingSymbolId(
    startNode: import('web-tree-sitter').Node,
    file: FileContent,
    nodes: ReadonlyMap<string, CodeNode>
): string | null {
    let current: import('web-tree-sitter').Node | null = startNode.parent;
    while(current) {
        // This is a simplified check. A full implementation would be more robust.
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