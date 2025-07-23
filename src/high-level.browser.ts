import type { 
  RepoGraphOptions, 
  RankedCodeGraph, 
  RepoGraphMap, 
  FileContent 
} from './types';
import { createMapGenerator } from './composer';
import { createDefaultDiscoverer } from './pipeline/discover.browser';
import { createTreeSitterAnalyzer } from './pipeline/analyze.browser';
import { createPageRanker } from './pipeline/rank';
import { createMarkdownRenderer } from './pipeline/render';
import { logger } from './utils/logger.util';

/**
 * Browser-compatible version of analyzeProject that works with in-memory file contents
 */
export async function analyzeProjectFromMemory(
  options: Omit<RepoGraphOptions, 'root'>,
  fileContents: Map<string, string>
): Promise<RankedCodeGraph> {
  logger.info('Starting project analysis from memory...');
  
  // Convert file contents to FileContent objects
  const files: FileContent[] = Array.from(fileContents.entries()).map(([path, content]) => ({
    path,
    content,
    size: content.length,
  }));
  
  // Filter files based on include/ignore patterns
  const filteredFiles = files.filter(file => {
    // Simple pattern matching for browser environment
    const shouldInclude = options.include?.some(pattern => 
      file.path.includes(pattern.replace('**/', '').replace('*', ''))
    ) ?? true;
    
    const shouldIgnore = options.ignore?.some(pattern => 
      file.path.includes(pattern.replace('**/', '').replace('*', ''))
    ) ?? false;
    
    return shouldInclude && !shouldIgnore;
  });
  
  logger.info(`Analyzing ${filteredFiles.length} files...`);
  
  // Create pipeline components
  const discoverer = createDefaultDiscoverer();
  const analyzer = createTreeSitterAnalyzer();
  const ranker = createPageRanker();
  
  // Create map generator
  const mapGenerator = createMapGenerator({
    discoverer,
    analyzer,
    ranker,
  });
  
  // Generate the graph
  const graph = await mapGenerator.generateGraph(filteredFiles, options);
  
  logger.info('Project analysis completed');
  return graph;
}

/**
 * Browser-compatible version of generateMap that works with in-memory file contents
 */
export async function generateMapFromMemory(
  options: Omit<RepoGraphOptions, 'root'>,
  fileContents: Map<string, string>
): Promise<RepoGraphMap> {
  const graph = await analyzeProjectFromMemory(options, fileContents);
  
  // Create renderer
  const renderer = createMarkdownRenderer();
  
  // Render the map
  const content = await renderer.render(graph, options.rendererOptions);
  
  return {
    content,
    metadata: {
      fileCount: fileContents.size,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      generatedAt: new Date().toISOString(),
    },
  };
}