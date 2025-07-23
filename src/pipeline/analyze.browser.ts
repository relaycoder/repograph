import type { Analyzer, CodeNode, CodeEdge, FileContent, UnresolvedRelation } from '../types';
import { getLanguageConfigForFile, type LanguageConfig } from '../tree-sitter/language-config';
import { loadLanguage } from '../tree-sitter/languages.browser';
import { logger } from '../utils/logger.util';
import { RepoGraphError } from '../utils/error.util';

/**
 * Browser-compatible Tree-sitter analyzer that uses web-tree-sitter
 */
export function createTreeSitterAnalyzer(): Analyzer {
  return {
    async analyze(files: FileContent[]): Promise<{ nodes: CodeNode[]; edges: CodeEdge[] }> {
      logger.info(`Analyzing ${files.length} files with Tree-sitter (browser mode)`);
      
      const allNodes: CodeNode[] = [];
      const allEdges: CodeEdge[] = [];
      const unresolvedRelations: UnresolvedRelation[] = [];
      
      // Process files in batches to avoid blocking the browser
      const batchSize = 10;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        
        for (const file of batch) {
          try {
            const result = await analyzeFile(file);
            allNodes.push(...result.nodes);
            allEdges.push(...result.edges);
            unresolvedRelations.push(...result.unresolvedRelations);
          } catch (error) {
            logger.warn(`Failed to analyze file ${file.path}: ${error}`);
          }
        }
        
        // Yield control to the browser event loop
        if (i + batchSize < files.length) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      
      // Resolve cross-file relationships
      const resolvedEdges = resolveRelations(unresolvedRelations, allNodes);
      allEdges.push(...resolvedEdges);
      
      logger.info(`Analysis complete: ${allNodes.length} nodes, ${allEdges.length} edges`);
      return { nodes: allNodes, edges: allEdges };
    },
  };
}

async function analyzeFile(file: FileContent): Promise<{
  nodes: CodeNode[];
  edges: CodeEdge[];
  unresolvedRelations: UnresolvedRelation[];
}> {
  const config = getLanguageConfigForFile(file.path);
  if (!config) {
    logger.debug(`No language config found for ${file.path}, skipping`);
    return { nodes: [], edges: [], unresolvedRelations: [] };
  }
  
  try {
    const language = await loadLanguage(config);
    const Parser = (await import('web-tree-sitter')).default;
    
    const parser = new Parser();
    parser.setLanguage(language);
    
    const tree = parser.parse(file.content);
    const query = language.query(config.query);
    const captures = query.captures(tree.rootNode);
    
    const nodes: CodeNode[] = [];
    const edges: CodeEdge[] = [];
    const unresolvedRelations: UnresolvedRelation[] = [];
    
    for (const capture of captures) {
      const node = createCodeNode(capture, file, config);
      if (node) {
        nodes.push(node);
        
        // Extract relationships from the node
        const relations = extractRelations(capture, file, config);
        unresolvedRelations.push(...relations);
      }
    }
    
    return { nodes, edges, unresolvedRelations };
  } catch (error) {
    throw new RepoGraphError(`Failed to parse ${file.path}: ${error}`);
  }
}

function createCodeNode(
  capture: any,
  file: FileContent,
  config: LanguageConfig
): CodeNode | null {
  const node = capture.node;
  const captureName = capture.name;
  
  // Extract node type from capture name
  const parts = captureName.split('.');
  const nodeType = parts[0] as any;
  
  if (!nodeType) return null;
  
  const startPosition = node.startPosition;
  const endPosition = node.endPosition;
  
  return {
    id: `${file.path}:${startPosition.row}:${startPosition.column}`,
    name: node.text.split('\n')[0].trim() || 'unnamed',
    type: nodeType,
    filePath: file.path,
    line: startPosition.row + 1,
    column: startPosition.column + 1,
    endLine: endPosition.row + 1,
    endColumn: endPosition.column + 1,
    visibility: 'public', // Default, could be extracted from AST
  };
}

function extractRelations(
  capture: any,
  file: FileContent,
  config: LanguageConfig
): UnresolvedRelation[] {
  // This is a simplified version - in a full implementation,
  // you'd extract actual relationships from the AST
  return [];
}

function resolveRelations(
  unresolvedRelations: UnresolvedRelation[],
  allNodes: CodeNode[]
): CodeEdge[] {
  const edges: CodeEdge[] = [];
  
  // Create a lookup map for nodes
  const nodeMap = new Map<string, CodeNode>();
  for (const node of allNodes) {
    nodeMap.set(node.name, node);
  }
  
  for (const relation of unresolvedRelations) {
    const sourceNode = allNodes.find(n => n.id === relation.sourceId);
    const targetNode = nodeMap.get(relation.targetName);
    
    if (sourceNode && targetNode) {
      edges.push({
        id: `${relation.sourceId}->${targetNode.id}`,
        source: relation.sourceId,
        target: targetNode.id,
        type: relation.type,
      });
    }
  }
  
  return edges;
}