import Graph from 'graphology';
import path from 'node:path';
import { getParser } from '../tree-sitter/languages.js';
import { TS_QUERY } from '../tree-sitter/queries.js';
import type { Analyzer, CodeGraph, CodeNode, CodeNodeType, FileContent } from '../types.js';

const getNodeText = (node: import('web-tree-sitter').SyntaxNode, content: string): string => {
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
    const tsLang = parser.getLanguage();
    const query = tsLang.query(TS_QUERY);

    const graph: Graph<CodeNode> = new Graph({
      multi: true,
      allowSelfLoops: false,
      type: 'directed',
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
      const captures = query.captures(tree.rootNode);

      const importSources = new Map<string, string>();

      for (const { name, node } of captures) {
        const [type, subtype] = name.split('.');
        
        if (type === 'import' && subtype === 'source') {
            const sourcePath = getNodeText(node, file.content).replace(/['"`]/g, '');
            const fromFileId = file.path;
            const toFileId = path.join(path.dirname(fromFileId), sourcePath).replace(/\.(ts|js)x?$/, '') + '.ts'; // Simplistic resolution
             
            if (graph.hasNode(toFileId)) {
                if(!graph.hasEdge(fromFileId, toFileId)) {
                   graph.addDirectedEdge(fromFileId, toFileId, { type: 'imports' });
                }
            }
            continue;
        }

        const definitionMap: Record<string, CodeNodeType> = {
          'class': 'class',
          'function': 'function',
          'function.arrow': 'arrow_function',
          'interface': 'interface',
          'type': 'type',
        };

        if (subtype === 'name' && definitionMap[type]) {
          const symbolType = definitionMap[type];
          const symbolName = getNodeText(node, file.content);
          const symbolId = `${file.path}#${symbolName}`;
          
          if (!graph.hasNode(symbolId)) {
            const definitionNode = captures.find(c => c.name.endsWith('.definition') && c.node.equals(node.parent!.parent!))?.node ?? node.parent!;
            graph.addNode(symbolId, {
              id: symbolId,
              type: symbolType,
              name: symbolName,
              filePath: file.path,
              startLine: getLineFromIndex(file.content, definitionNode.startIndex),
              endLine: getLineFromIndex(file.content, definitionNode.endIndex),
              codeSnippet: definitionNode.text.split('{')[0].trim(),
            });
            // Add edge from file to the symbol it contains
            graph.addDirectedEdge(file.path, symbolId, { type: 'contains' });
          }
        }
      }
    }
    return graph;
  };
};