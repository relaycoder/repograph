import Graph from 'graphology';
import path from 'node:path';
import { getParser } from '../tree-sitter/languages.js';
import { TS_QUERY } from '../tree-sitter/queries.js';
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
 * @returns An Analyzer function.
 */
export const createTreeSitterAnalyzer = (): Analyzer => {
  return async (files: readonly FileContent[]) => {
    const parser = await getParser();
    const tsLang = parser.language;
    if (!tsLang) {
      throw new Error('Parser language not set');
    }
    const query = new (await import('web-tree-sitter')).Query(tsLang, TS_QUERY);

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

    // Phase 2: Parse files and add symbol nodes and edges
    for (const file of files) {
      const tree = parser.parse(file.content);
      if (!tree) {
        continue; // Skip files that couldn't be parsed
      }
      const captures = query.captures(tree.rootNode);

      const processedSymbols = new Set<string>();
      const processedClassNodes = new Set<number>(); // Track which class declaration nodes were processed
      const duplicateClassNames = new Set<string>(); // Track class names that have duplicates

      // First pass: identify duplicate class names
      const seenClassNodes = new Set<number>(); // Track actual class declaration nodes
      const classNames = new Map<string, number>(); // symbolId -> count
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
            // Skip if we've already seen this exact class declaration node
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

      // Second pass: process symbols
      for (const { name, node } of captures) {
        const parts = name.split('.');
        const type = parts.slice(0, -1).join('.');
        const subtype = parts[parts.length - 1];
        if (type === 'import' && subtype === 'source') {
          const sourcePath = getNodeText(node, file.content).replace(/['"`]/g, '');
          const fromFileId = file.path;
          let toFileId = path.normalize(path.join(path.dirname(fromFileId), sourcePath));
          
          if (/\.(js|jsx|mjs)$/.test(toFileId)) {
            const tsVariant = toFileId.replace(/\.(js|jsx|mjs)$/, '.ts');
            if (graph.hasNode(tsVariant)) toFileId = tsVariant;
          }
          // Handle extensionless imports
          if (!path.extname(toFileId) && graph.hasNode(`${toFileId}.ts`)) {
            toFileId = `${toFileId}.ts`;
          }
           
          if (graph.hasNode(toFileId)) {
            if (!graph.hasEdge(fromFileId, toFileId)) {
              graph.addDirectedEdge(fromFileId, toFileId, { type: 'imports' });
            }
          }
          continue;
        }

        if (subtype !== 'definition') continue;

        const definitionMap: Record<string, CodeNodeType> = {
          class: 'class',
          function: 'function',
          'function.arrow': 'arrow_function',
          interface: 'interface',
          type: 'type',
          method: 'method',
          field: 'field',
        };
        const symbolType = definitionMap[name] || definitionMap[type!];
        if (!symbolType) continue;

        // Skip field definitions that are actually arrow functions (they'll be handled by the arrow function capture)
        if (symbolType === 'field' && node.type === 'public_field_definition') {
          const valueNode = node.childForFieldName('value');
          if (valueNode && valueNode.type === 'arrow_function') {
            continue; // Skip this, it will be handled by the arrow function capture
          }
        }

        let declarationNode = node;
        let nameNode: import('web-tree-sitter').Node | null = null;
        
        // Handle different node structures based on symbol type
        if (symbolType === 'method' || symbolType === 'field') {
          // For methods and fields, we need to find the containing class
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
                const classSymbolId = `${file.path}#${className}`;
                
                // Only add methods/fields if this specific class declaration was processed
                // and the class name is not duplicated
                if (processedClassNodes.has(classParent.startIndex) && !duplicateClassNames.has(className)) {
                  nameNode = declarationNode.childForFieldName('name');
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
          continue; // Skip the normal processing for methods and fields
        } else if (symbolType === 'arrow_function') {
          if (declarationNode.type === 'export_statement') {
            // For exported arrow functions: export_statement -> lexical_declaration -> variable_declarator
            const lexicalDecl = declarationNode.namedChildren[0];
            if (lexicalDecl?.type === 'lexical_declaration') {
              const variableDeclarator = lexicalDecl.namedChildren[0];
              if (variableDeclarator?.type === 'variable_declarator') {
                nameNode = variableDeclarator.childForFieldName('name');
                declarationNode = variableDeclarator;
              }
            }
          } else if (declarationNode.type === 'variable_declarator') {
            // For regular arrow functions: variable_declarator
            nameNode = declarationNode.childForFieldName('name');
          } else if (declarationNode.type === 'public_field_definition') {
            // For class field arrow functions: public_field_definition
            nameNode = declarationNode.childForFieldName('name');
          }
        } else {
          // For non-arrow functions, the captured node might be an export statement,
          // so we need to get the actual declaration.
          if (declarationNode.type === 'export_statement') {
            declarationNode = declarationNode.namedChildren[0] ?? declarationNode;
          }
          nameNode = declarationNode.childForFieldName('name');
        }

        if (nameNode) {
          const symbolName = nameNode.text;
          const symbolId = `${file.path}#${symbolName}`;
          
          // Skip if we've already processed this symbol or if the node already exists
          if (symbolName && !processedSymbols.has(symbolId) && !graph.hasNode(symbolId)) {
            processedSymbols.add(symbolId);
            
            // For class declarations, track the specific node that was processed
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
    return graph;

  };
};