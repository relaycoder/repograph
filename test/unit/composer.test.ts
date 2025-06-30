import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createMapGenerator } from '../../src/composer.js';
import { createDefaultDiscoverer } from '../../src/pipeline/discover.js';
import { createTreeSitterAnalyzer } from '../../src/pipeline/analyze.js';
import { createPageRanker } from '../../src/pipeline/rank.js';
import { createMarkdownRenderer } from '../../src/pipeline/render.js';
import type { FileDiscoverer, Analyzer, Ranker, Renderer, FileContent } from '../../src/types.js';
import {
  createTempDir, // Keep for beforeEach/afterEach
  cleanupTempDir,
  createTestFiles,
  assertFileExists,
  isValidMarkdown,
} from '../test.util.js';
import path from 'node:path';
import fs from 'node:fs/promises';

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

    it('should create output directory if it does not exist', async () => {
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

      await assertFileExists(outputPath);
      const content = await fs.readFile(outputPath, 'utf-8');
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('This repository contains 0 nodes (0 files)');
    });
  });

  describe('Custom Components', () => {
    let discoveredFiles: FileContent[] = [];
    it('should work with custom discoverer', async () => {
      const files = {
        'src/index.ts': 'export const ts = true;',
        'src/index.js': 'export const js = true;'
      };
      await createTestFiles(tempDir, files);

      // Custom discoverer that tracks what it found
      const customDiscoverer: FileDiscoverer = async (options) => {
        const defaultDiscoverer = createDefaultDiscoverer();
        discoveredFiles = await defaultDiscoverer(options);
        return discoveredFiles;
      };

      const generator = createMapGenerator({
        discover: customDiscoverer,
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'custom.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      expect(discoveredFiles.some(f => f.path === 'src/index.js')).toBe(true);
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

      let wasCustomAnalyzerCalled = false;
      const customAnalyzer: Analyzer = async (files) => {
        wasCustomAnalyzerCalled = true;
        const defaultAnalyzer = createTreeSitterAnalyzer();
        return await defaultAnalyzer(files);
      };

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: customAnalyzer,
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'custom.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      expect(wasCustomAnalyzerCalled).toBe(true);
      await assertFileExists(outputPath);
    });

    it('should work with custom ranker', async () => {
      const files = {
        'src/a.ts': 'export const a = true;',
        'src/b.ts': 'export const b = true;',
        'src/c.ts': 'export const c = true;'
      };
      await createTestFiles(tempDir, files);

      let wasCustomRankerCalled = false;
      const customRanker: Ranker = async (graph) => {
        wasCustomRankerCalled = true;
        return await createPageRanker()(graph);
      };

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: customRanker,
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'custom.md');
      await generator({ root: tempDir, output: outputPath });

      expect(wasCustomRankerCalled).toBe(true);
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

      let wasCustomRendererCalled = false;
      const customRenderer: Renderer = (rankedGraph, options) => {
        wasCustomRendererCalled = true;
        return createMarkdownRenderer()(rankedGraph, options);
      };

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: customRenderer
      });

      const outputPath = path.join(tempDir, 'custom.md');
      await generator({
        root: tempDir,
        output: outputPath
      });
      expect(wasCustomRendererCalled).toBe(true);
    });

    it('should work with all custom components', async () => {
      const files = {
        'custom.special': 'special file content',
        'src/index.ts': 'export const normal = true;'
      };
      await createTestFiles(tempDir, files);

      const customDiscoverer: FileDiscoverer = async () => [{ path: 'custom.special', content: 'custom' }];
      const customAnalyzer: Analyzer = async () => ({ nodes: new Map(), edges: [] });
      const customRanker: Ranker = async (g) => ({ ...g, ranks: new Map() });
      const customRenderer: Renderer = () => 'CUSTOM RENDERER OUTPUT';

      const generator = createMapGenerator({
        discover: customDiscoverer,
        analyze: customAnalyzer,
        rank: customRanker,
        render: customRenderer
      });

      const outputPath = path.join(tempDir, 'custom.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toBe('CUSTOM RENDERER OUTPUT');
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

      const trackingRanker: Ranker = async (graph) => {
        rankedGraph = graph;
        const defaultRanker = createPageRanker();
        return await defaultRanker(graph);
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

      const trackingRanker: Ranker = async (graph) => {
        const defaultRanker = createPageRanker();
        rankerOutput = await defaultRanker(graph);
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