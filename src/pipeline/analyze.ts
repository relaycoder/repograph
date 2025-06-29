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
    const query = tsLang.query(TS_QUERY);

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

      const processedDefinitions = new Set<number>();

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
        if (processedDefinitions.has(node.startIndex)) continue;
        processedDefinitions.add(node.startIndex);

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
                nameNode = declarationNode.childForFieldName('name');
                if (nameNode) {
                  const methodName = nameNode.text;
                  const symbolName = `${className}.${methodName}`;
                  const symbolId = `${file.path}#${symbolName}`;
                  if (!graph.hasNode(symbolId)) {
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
          if (symbolName && !graph.hasNode(symbolId)) {
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