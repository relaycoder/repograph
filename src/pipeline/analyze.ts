import Graph from 'graphology';
import path from 'node:path';
import { createParserForLanguage } from '../tree-sitter/languages.js';
import { getLanguageConfigForFile } from '../tree-sitter/language-config.js';
import type { Analyzer, CodeNode, CodeNodeType, FileContent } from '../types.js';

const getNodeText = (node: import('web-tree-sitter').Node, content: string): string => {
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
    const graph: Graph<CodeNode> = new Graph({
      allowSelfLoops: false,
      type: 'directed',
      multi: true,
    });

    // Phase 1: Add all files as nodes
    for (const file of files) {
      const fileId = file.path;
      if (!graph.hasNode(fileId)) {
        graph.addNode(fileId, {
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

    // Phase 3: Process each language group
    for (const [languageName, languageFiles] of filesByLanguage) {
      const languageConfig = getLanguageConfigForFile(languageFiles[0].path);
      if (!languageConfig) continue;

      try {
        const parser = await createParserForLanguage(languageConfig);
        const query = new (await import('web-tree-sitter')).Query(parser.language, languageConfig.query);

        await processFilesForLanguage(graph, languageFiles, parser, query, languageConfig);
      } catch (error) {
        console.warn(`Failed to process ${languageName} files:`, error);
        // Continue processing other languages
      }
    }

    return graph;
  };
};

/**
 * Process files for a specific language
 */
async function processFilesForLanguage(
  graph: Graph<CodeNode>,
  files: FileContent[],
  parser: import('web-tree-sitter').Parser,
  query: import('web-tree-sitter').Query,
  languageConfig: import('./language-config.js').LanguageConfig
): Promise<void> {
  for (const file of files) {
    const tree = parser.parse(file.content);
    if (!tree) {
      continue; // Skip files that couldn't be parsed
    }
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

    // Second pass: process symbols
    for (const { name, node } of captures) {
      const parts = name.split('.');
      const type = parts.slice(0, -1).join('.');
      const subtype = parts[parts.length - 1];

      // Handle imports
      if (type === 'import' && subtype === 'source') {
        await processImport(graph, file, node, languageConfig);
        continue;
      }

      if (subtype !== 'definition') continue;

      // Map capture names to symbol types
      const symbolType = getSymbolTypeFromCapture(name, type, languageConfig);
      if (!symbolType) continue;

      // Process the symbol
      await processSymbol(
        graph, 
        file, 
        node, 
        name, 
        type, 
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
 * Process an import statement
 */
async function processImport(
  graph: Graph<CodeNode>,
  file: FileContent,
  node: import('web-tree-sitter').Node,
  languageConfig: import('./language-config.js').LanguageConfig
): Promise<void> {
  // This is simplified - different languages have different import handling
  if (languageConfig.name === 'typescript') {
    const sourcePath = getNodeText(node, file.content).replace(/['"`]/g, '');
    const fromFileId = file.path;
    let toFileId = path.normalize(path.join(path.dirname(fromFileId), sourcePath));
    
    if (/\.(js|jsx|mjs)$/.test(toFileId)) {
      const tsVariant = toFileId.replace(/\.(js|jsx|mjs)$/, '.ts');
      if (graph.hasNode(tsVariant)) toFileId = tsVariant;
    }
    if (!path.extname(toFileId) && graph.hasNode(`${toFileId}.ts`)) {
      toFileId = `${toFileId}.ts`;
    }
     
    if (graph.hasNode(toFileId)) {
      if (!graph.hasEdge(fromFileId, toFileId)) {
        graph.addDirectedEdge(fromFileId, toFileId, { type: 'imports' });
      }
    }
  }
  // TODO: Add import handling for other languages
}

/**
 * Get symbol type from capture name and language
 */
function getSymbolTypeFromCapture(
  captureName: string, 
  type: string, 
  languageConfig: import('./language-config.js').LanguageConfig
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
  graph: Graph<CodeNode>,
  file: FileContent,
  node: import('web-tree-sitter').Node,
  captureName: string,
  type: string,
  symbolType: CodeNodeType,
  processedSymbols: Set<string>,
  processedClassNodes: Set<number>,
  duplicateClassNames: Set<string>,
  languageConfig: import('./language-config.js').LanguageConfig
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
    const result = await processTypeScriptMethodOrField(
      graph, file, node, symbolType, processedSymbols, processedClassNodes, duplicateClassNames
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
    
    if (symbolName && !processedSymbols.has(symbolId) && !graph.hasNode(symbolId)) {
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
      
      graph.addNode(symbolId, {
        id: symbolId, 
        type: symbolType, 
        name: symbolName, 
        filePath: file.path,
        startLine: getLineFromIndex(file.content, node.startIndex),
        endLine: getLineFromIndex(file.content, node.endIndex),
        codeSnippet: node.text?.split('{')[0]?.trim() || '',
      });
      graph.addDirectedEdge(file.path, symbolId, { type: 'contains' });
    }
  }
}

/**
 * TypeScript-specific method/field processing
 */
async function processTypeScriptMethodOrField(
  graph: Graph<CodeNode>,
  file: FileContent,
  node: import('web-tree-sitter').Node,
  symbolType: CodeNodeType,
  processedSymbols: Set<string>,
  processedClassNodes: Set<number>,
  duplicateClassNames: Set<string>
): Promise<boolean> {
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
            if (!processedSymbols.has(symbolId) && !graph.hasNode(symbolId)) {
              processedSymbols.add(symbolId);
              graph.addNode(symbolId, {
                id: symbolId, type: symbolType, name: symbolName, filePath: file.path,
                startLine: getLineFromIndex(file.content, node.startIndex),
                endLine: getLineFromIndex(file.content, node.endIndex),
                codeSnippet: node.text?.split('{')[0]?.trim() || '',
              });
              graph.addDirectedEdge(file.path, symbolId, { type: 'contains' });
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