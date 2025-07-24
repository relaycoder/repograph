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