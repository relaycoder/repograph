import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createMapGenerator } from '../../src/composer.js';
import { createDefaultDiscoverer } from '../../src/pipeline/discover.js';
import { createTreeSitterAnalyzer } from '../../src/pipeline/analyze.js';
import { createPageRanker } from '../../src/pipeline/rank.js';
import { createMarkdownRenderer } from '../../src/pipeline/render.js';
import type { FileDiscoverer, Analyzer, Ranker, Renderer, FileContent } from '../../src/types.js';
import {
  createTempDir,
  cleanupTempDir,
  createTestFiles,
  assertFileExists,
  readFile,
  isValidMarkdown
} from '../test.util.js';
import path from 'node:path';

describe('Composer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('createMapGenerator()', () => {
    it('should return a function when given valid components', () => {
      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      expect(typeof generator).toBe('function');
    });

    it('should require all four components', () => {
      expect(() => createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker()
        // Missing render
      } as any)).toThrow();

      expect(() => createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        // Missing rank
        render: createMarkdownRenderer()
      } as any)).toThrow();

      expect(() => createMapGenerator({
        discover: createDefaultDiscoverer(),
        // Missing analyze
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      } as any)).toThrow();

      expect(() => createMapGenerator({
        // Missing discover
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      } as any)).toThrow();
    });

    it('should execute the full pipeline with default components', async () => {
      const files = {
        'src/index.ts': `export class Example {
  method(): string {
    return 'hello';
  }
}`
      };
      await createTestFiles(tempDir, files);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'output.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      await assertFileExists(outputPath);
      const content = await readFile(outputPath);
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('Example');
    });

    it('should pass options through the pipeline correctly', async () => {
      const files = {
        'src/index.ts': 'export const ts = true;',
        'src/index.js': 'export const js = true;',
        'src/test.spec.ts': 'test code'
      };
      await createTestFiles(tempDir, files);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'filtered.md');
      await generator({
        root: tempDir,
        output: outputPath,
        include: ['**/*.ts'],
        ignore: ['**/*.spec.ts']
      });

      const content = await readFile(outputPath);
      expect(content).toContain('src/index.ts');
      expect(content).not.toContain('src/index.js');
      expect(content).not.toContain('src/test.spec.ts');
    });

    it('should pass renderer options correctly', async () => {
      const files = {
        'src/index.ts': `export class Test {
  method(): void {}
}`
      };
      await createTestFiles(tempDir, files);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'custom.md');
      await generator({
        root: tempDir,
        output: outputPath,
        rendererOptions: {
          customHeader: '# Custom Project',
          includeMermaidGraph: false,
          includeSymbolDetails: false
        }
      });

      const content = await readFile(outputPath);
      expect(content).toStartWith('# Custom Project');
      expect(content).not.toContain('```mermaid');
      expect(content).not.toContain('## 📂 File & Symbol Breakdown');
    });

    it('should create output directory if it does not exist', async () => {
      const files = {
        'src/index.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'nested', 'deep', 'output.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      await assertFileExists(outputPath);
    });

    it('should handle empty projects gracefully', async () => {
      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'empty.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('This repository contains 0 nodes (0 files)');
    });
  });

  describe('Custom Components', () => {
    it('should work with custom discoverer', async () => {
      const files = {
        'src/index.ts': 'export const ts = true;',
        'src/index.js': 'export const js = true;'
      };
      await createTestFiles(tempDir, files);

      // Custom discoverer that only finds .js files
      const customDiscoverer: FileDiscoverer = async (options) => {
        const defaultDiscoverer = createDefaultDiscoverer();
        const allFiles = await defaultDiscoverer(options);
        return allFiles.filter(file => file.path.endsWith('.js'));
      };

      const generator = createMapGenerator({
        discover: customDiscoverer,
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'js-only.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      expect(content).toContain('src/index.js');
      expect(content).not.toContain('src/index.ts');
    });

    it('should work with custom analyzer', async () => {
      const files = {
        'src/index.ts': `export class Example {
  method(): string {
    return 'hello';
  }
}`
      };
      await createTestFiles(tempDir, files);

      // Custom analyzer that adds extra metadata
      const customAnalyzer: Analyzer = async (files) => {
        const defaultAnalyzer = createTreeSitterAnalyzer();
        const graph = await defaultAnalyzer(files);
        
        // Add custom metadata to all nodes
        graph.forEachNode(nodeId => {
          (graph as any).setNodeAttribute(nodeId, 'customMetadata', 'processed by custom analyzer');
        });
        
        return graph;
      };

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: customAnalyzer,
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'custom-analyzed.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      await assertFileExists(outputPath);
    });

    it('should work with custom ranker', async () => {
      const files = {
        'src/a.ts': 'export const a = true;',
        'src/b.ts': 'export const b = true;',
        'src/c.ts': 'export const c = true;'
      };
      await createTestFiles(tempDir, files);

      // Custom ranker that assigns alphabetical ranks
      const customRanker: Ranker = async (graph, _files) => {
        const ranks = new Map<string, number>();
        const fileNodes = graph.filterNodes(nodeId => 
          graph.getNodeAttribute(nodeId, 'type') === 'file'
        );
        
        fileNodes.sort().forEach((nodeId, index) => {
          ranks.set(nodeId, 1 - (index / fileNodes.length));
        });
        
        // Set rank 0 for non-file nodes
        graph.forEachNode(nodeId => {
          if (!ranks.has(nodeId)) {
            ranks.set(nodeId, 0);
          }
        });
        
        return { graph, ranks };
      };

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: customRanker,
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'custom-ranked.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      // src/a.ts should be ranked highest (alphabetically first)
      const aIndex = content.indexOf('src/a.ts');
      const bIndex = content.indexOf('src/b.ts');
      expect(aIndex).toBeLessThan(bIndex);
    });

    it('should work with custom renderer', async () => {
      const files = {
        'src/index.ts': `export class Example {
  method(): string {
    return 'hello';
  }
}`
      };
      await createTestFiles(tempDir, files);

      // Custom renderer that adds extra sections
      const customRenderer: Renderer = (rankedGraph, options) => {
        const defaultRenderer = createMarkdownRenderer();
        const baseMarkdown = defaultRenderer(rankedGraph, options);
        
        return `${baseMarkdown}\n\n## Custom Section\n\nThis was added by a custom renderer.\n\n### Statistics\n- Total nodes: ${rankedGraph.graph.order}\n- Total edges: ${rankedGraph.graph.size}`;
      };

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: customRenderer
      });

      const outputPath = path.join(tempDir, 'custom-rendered.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      expect(content).toContain('## Custom Section');
      expect(content).toContain('This was added by a custom renderer');
      expect(content).toContain('### Statistics');
      expect(content).toContain('Total nodes:');
      expect(content).toContain('Total edges:');
    });

    it('should work with all custom components', async () => {
      const files = {
        'custom.special': 'special file content',
        'src/index.ts': 'export const normal = true;'
      };
      await createTestFiles(tempDir, files);

      // Custom discoverer for .special files
      const customDiscoverer: FileDiscoverer = async (options) => {
        const defaultDiscoverer = createDefaultDiscoverer();
        const defaultFiles = await defaultDiscoverer(options);
        
        // Add special files
        const specialFiles = defaultFiles.filter(f => f.path.endsWith('.special'));
        return [...defaultFiles, ...specialFiles];
      };

      // Custom analyzer that handles .special files
      const customAnalyzer: Analyzer = async (files) => {
        const defaultAnalyzer = createTreeSitterAnalyzer();
        const graph = await defaultAnalyzer(files.filter(f => !f.path.endsWith('.special')));
        
        // Add special file nodes
        files.filter(f => f.path.endsWith('.special')).forEach(file => {
          graph.addNode(file.path, {
            id: file.path,
            type: 'special' as any,
            name: path.basename(file.path),
            filePath: file.path,
            startLine: 1,
            endLine: 1
          });
        });
        
        return graph;
      };

      // Custom ranker that gives special files high rank
      const customRanker: Ranker = async (graph, _files) => {
        const ranks = new Map<string, number>();
        
        graph.forEachNode(nodeId => {
          const nodeType = graph.getNodeAttribute(nodeId, 'type') as string;
          if (nodeType === 'special') {
            ranks.set(nodeId, 1.0);
          } else {
            ranks.set(nodeId, 0.5);
          }
        });
        
        return { graph, ranks };
      };

      // Custom renderer that handles special files
      const customRenderer: Renderer = (rankedGraph, options) => {
        const specialNodes = rankedGraph.graph.filterNodes(nodeId =>
          (rankedGraph.graph.getNodeAttribute(nodeId, 'type') as string) === 'special'
        );
        
        let markdown = '# Custom Project with Special Files\n\n';
        
        if (specialNodes.length > 0) {
          markdown += '## Special Files\n\n';
          specialNodes.forEach(nodeId => {
            const node = rankedGraph.graph.getNodeAttributes(nodeId);
            markdown += `- **${node.name}** (rank: ${rankedGraph.ranks.get(nodeId)?.toFixed(2)})\n`;
          });
          markdown += '\n';
        }
        
        const defaultRenderer = createMarkdownRenderer();
        const baseMarkdown = defaultRenderer(rankedGraph, options);
        
        return markdown + baseMarkdown.split('\n').slice(2).join('\n'); // Remove default header
      };

      const generator = createMapGenerator({
        discover: customDiscoverer,
        analyze: customAnalyzer,
        rank: customRanker,
        render: customRenderer
      });

      const outputPath = path.join(tempDir, 'all-custom.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      expect(content).toContain('# Custom Project with Special Files');
      expect(content).toContain('## Special Files');
      expect(content).toContain('custom.special');
    });
  });

  describe('Error Handling', () => {
    it('should handle discoverer errors gracefully', async () => {
      const errorDiscoverer: FileDiscoverer = async () => {
        throw new Error('Discoverer failed');
      };

      const generator = createMapGenerator({
        discover: errorDiscoverer,
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'error.md');
      
      await expect(generator({
        root: tempDir,
        output: outputPath
      })).rejects.toThrow('Discoverer failed');
    });

    it('should handle analyzer errors gracefully', async () => {
      const files = {
        'src/index.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const errorAnalyzer: Analyzer = async () => {
        throw new Error('Analyzer failed');
      };

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: errorAnalyzer,
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'error.md');
      
      await expect(generator({
        root: tempDir,
        output: outputPath
      })).rejects.toThrow('Analyzer failed');
    });

    it('should handle ranker errors gracefully', async () => {
      const files = {
        'src/index.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const errorRanker: Ranker = async () => {
        throw new Error('Ranker failed');
      };

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: errorRanker,
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'error.md');
      
      await expect(generator({
        root: tempDir,
        output: outputPath
      })).rejects.toThrow('Ranker failed');
    });

    it('should handle renderer errors gracefully', async () => {
      const files = {
        'src/index.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const errorRenderer: Renderer = () => {
        throw new Error('Renderer failed');
      };

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: errorRenderer
      });

      const outputPath = path.join(tempDir, 'error.md');
      
      await expect(generator({
        root: tempDir,
        output: outputPath
      })).rejects.toThrow('Renderer failed');
    });

    it('should handle file write errors gracefully', async () => {
      const files = {
        'src/index.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      // Try to write to an invalid path
      const invalidOutputPath = '/root/cannot-write.md';
      
      await expect(generator({
        root: tempDir,
        output: invalidOutputPath
      })).rejects.toThrow();
    });
  });

  describe('Component Interface Validation', () => {
    it('should validate discoverer interface', () => {
      const invalidDiscoverer = 'not a function';
      
      expect(() => createMapGenerator({
        discover: invalidDiscoverer as any,
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      })).toThrow();
    });

    it('should validate analyzer interface', () => {
      const invalidAnalyzer = 'not a function';
      
      expect(() => createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: invalidAnalyzer as any,
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      })).toThrow();
    });

    it('should validate ranker interface', () => {
      const invalidRanker = 'not a function';
      
      expect(() => createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: invalidRanker as any,
        render: createMarkdownRenderer()
      })).toThrow();
    });

    it('should validate renderer interface', () => {
      const invalidRenderer = 'not a function';
      
      expect(() => createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: invalidRenderer as any
      })).toThrow();
    });
  });

  describe('Pipeline Data Flow', () => {
    it('should pass files from discoverer to analyzer', async () => {
      const files = {
        'src/a.ts': 'export const a = true;',
        'src/b.ts': 'export const b = true;'
      };
      await createTestFiles(tempDir, files);

      let discoveredFiles: readonly FileContent[] = [];
      let analyzedFiles: readonly FileContent[] = [];

      const trackingDiscoverer: FileDiscoverer = async (options) => {
        const defaultDiscoverer = createDefaultDiscoverer();
        discoveredFiles = await defaultDiscoverer(options);
        return discoveredFiles;
      };

      const trackingAnalyzer: Analyzer = async (files) => {
        analyzedFiles = files;
        const defaultAnalyzer = createTreeSitterAnalyzer();
        return await defaultAnalyzer(files);
      };

      const generator = createMapGenerator({
        discover: trackingDiscoverer,
        analyze: trackingAnalyzer,
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'tracking.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      expect(discoveredFiles.length).toBe(2);
      expect(analyzedFiles.length).toBe(2);
      expect(analyzedFiles).toEqual(discoveredFiles);
    });

    it('should pass graph from analyzer to ranker', async () => {
      const files = {
        'src/index.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      let analyzedGraph: any;
      let rankedGraph: any;

      const trackingAnalyzer: Analyzer = async (files) => {
        const defaultAnalyzer = createTreeSitterAnalyzer();
        analyzedGraph = await defaultAnalyzer(files);
        return analyzedGraph;
      };

      const trackingRanker: Ranker = async (graph, files) => {
        rankedGraph = graph;
        const defaultRanker = createPageRanker();
        return await defaultRanker(graph, files);
      };

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: trackingAnalyzer,
        rank: trackingRanker,
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'tracking.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      expect(rankedGraph).toBe(analyzedGraph);
    });

    it('should pass ranked graph from ranker to renderer', async () => {
      const files = {
        'src/index.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      let rankerOutput: any;
      let rendererInput: any;

      const trackingRanker: Ranker = async (graph, files) => {
        const defaultRanker = createPageRanker();
        rankerOutput = await defaultRanker(graph, files);
        return rankerOutput;
      };

      const trackingRenderer: Renderer = (rankedGraph, options) => {
        rendererInput = rankedGraph;
        const defaultRenderer = createMarkdownRenderer();
        return defaultRenderer(rankedGraph, options);
      };

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: trackingRanker,
        render: trackingRenderer
      });

      const outputPath = path.join(tempDir, 'tracking.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      expect(rendererInput).toBe(rankerOutput);
    });
  });
});