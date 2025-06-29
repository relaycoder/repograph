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
      multi: false,
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
        const [type, subtype] = name.split('.');
        
        if (type === 'import' && subtype === 'source') {
          const sourcePath = getNodeText(node, file.content).replace(/['"`]/g, '');
          const fromFileId = file.path;
          const toFileId = path.join(path.dirname(fromFileId), sourcePath).replace(/\.(ts|js)x?$/, '') + '.ts'; // Simplistic resolution
           
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
        };
        const symbolType = definitionMap[type!];
        if (!symbolType) continue;

        // For exports, the actual declaration is nested.
        const declarationNode = node.type === 'export_statement' ? node.namedChildren[0] : node;
        if (!declarationNode) continue;

        const nameNode = declarationNode.childForFieldName('name') ?? declarationNode.firstNamedChild?.childForFieldName('name');

        if (nameNode) {
          const symbolName = nameNode.text;
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
    return graph;
  };
};