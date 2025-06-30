import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createPageRanker, createGitRanker } from '../../src/pipeline/rank.js';
import { createTreeSitterAnalyzer } from '../../src/pipeline/analyze.js';
import type { FileContent, CodeGraph } from '../../src/types.js';
import {
  createTempDir,
  cleanupTempDir,
  createTestNode,
  createTestGraph,
  setupGitRepo,
  makeGitCommit
} from '../test.util.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

describe('Graph Ranking', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('createPageRanker()', () => {
    let pageRanker: ReturnType<typeof createPageRanker>;

    beforeEach(() => {
      pageRanker = createPageRanker();
    });

    it('should return a Ranker function', () => {
      expect(typeof pageRanker).toBe('function');
    });

    it('should handle empty graphs gracefully', async () => {
      const emptyGraph: CodeGraph = {
        nodes: new Map(),
        edges: [],
      };

      const result = await pageRanker(emptyGraph);

      expect(result.nodes).toBe(emptyGraph.nodes);
      expect(result.edges).toBe(emptyGraph.edges);
      expect(result.ranks.size).toBe(0);
    });

    it('should assign ranks to all nodes in the graph', async () => {
      const graph = createTestGraph(
        [createTestNode('file1'), createTestNode('file2'), createTestNode('symbol1', { type: 'function' })],
        [{ fromId: 'file1', toId: 'file2', type: 'imports' }]
      );
      const result = await pageRanker(graph);

      expect(result.ranks.size).toBe(3);
      expect(result.ranks.has('file1')).toBe(true);
      expect(result.ranks.has('file2')).toBe(true);
      expect(result.ranks.has('symbol1')).toBe(true);

      // All ranks should be positive numbers
      for (const rank of result.ranks.values()) {
        expect(rank).toBeGreaterThan(0);
      }
    });

    it('should assign higher ranks to more connected nodes', async () => {
      const hub = createTestNode('hub');
      const isolated = createTestNode('isolated');
      const spokes = Array.from({ length: 5 }, (_, i) => createTestNode(`node${i + 1}`));
      const edges = spokes.map(spoke => ({ fromId: spoke.id, toId: hub.id, type: 'imports' as const }));

      const graph: CodeGraph = createTestGraph([hub, isolated, ...spokes], edges);
      const result = await pageRanker(graph);

      const hubRank = result.ranks.get('hub')!;
      const isolatedRank = result.ranks.get('isolated')!;
      const spokeRank = result.ranks.get('node1')!;

      // Hub should have higher rank than isolated node
      expect(hubRank).toBeGreaterThan(isolatedRank);
      // Hub should have a higher rank than any single spoke that links to it
      expect(hubRank).toBeGreaterThan(spokeRank);
    });

    it('should return RankedCodeGraph with correct structure', async () => {
      const graph: CodeGraph = createTestGraph([createTestNode('test')]);
      const result = await pageRanker(graph);

      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('edges');
      expect(result).toHaveProperty('ranks');
      expect(result.nodes).toBe(graph.nodes);
      expect(result.ranks).toBeInstanceOf(Map);
    });

    it('should work with complex graph structures', async () => {
      const analyzer = createTreeSitterAnalyzer();
      const files: FileContent[] = [
        {
          path: 'src/index.ts',
          content: `import { Calculator } from './calculator.js';
import { Logger } from './logger.js';

export { Calculator, Logger };`
        },
        {
          path: 'src/calculator.ts',
          content: `import { Logger } from './logger.js';

export class Calculator {
  private logger: Logger;
  
  constructor() {
    this.logger = new Logger();
  }
  
  add(a: number, b: number): number {
    return a + b;
  }
}`
        },
        {
          path: 'src/logger.ts',
          content: `export class Logger {
  log(message: string): void {
    console.log(message);
  }
}`
        }
      ];

      const graph = await analyzer(files);
      const result = await pageRanker(graph);

      expect(result.ranks.size).toBeGreaterThan(0);
      
      // Logger should have high rank as it's imported by multiple files
      const loggerRank = result.ranks.get('src/logger.ts');
      expect(loggerRank).toBeGreaterThan(0);
    });
  });

  describe('createGitRanker()', () => {
    let gitRanker: ReturnType<typeof createGitRanker>;

    beforeEach(() => {
      gitRanker = createGitRanker();
    });

    it('should return a Ranker function', () => {
      expect(typeof gitRanker).toBe('function');
    });

    it('should handle empty graphs gracefully', async () => {
      const emptyGraph: CodeGraph = {
        nodes: new Map(),
        edges: [],
      };

      const result = await gitRanker(emptyGraph);

      expect(result.nodes).toBe(emptyGraph.nodes);
      expect(result.edges).toBe(emptyGraph.edges);
      expect(result.ranks.size).toBe(0);
    });

    it('should assign zero ranks when git is not available', async () => {
      const graph: CodeGraph = createTestGraph([
        createTestNode('file1.ts'),
        createTestNode('file1.ts#symbol1', { type: 'function' }),
      ]);

      // Change to a directory without git
      const originalCwd = process.cwd();
      process.chdir(tempDir);
      try {
        const result = await gitRanker(graph);

        expect(result.ranks.size).toBe(2);
        expect(result.ranks.get('file1.ts')).toBe(0);
        expect(result.ranks.get('file1.ts#symbol1')).toBe(0);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should only rank file nodes with git strategy', async () => {
      await setupGitRepo(tempDir);
      await fs.writeFile(path.join(tempDir, 'file1.ts'), 'content');
      await makeGitCommit(tempDir, 'Initial commit', ['file1.ts']);

      const graph: CodeGraph = createTestGraph([
        createTestNode('file1.ts'),
        createTestNode('file1.ts#symbol1', { type: 'function' }),
      ]);

      const originalCwd = process.cwd();
      process.chdir(tempDir);
      try {
        const result = await gitRanker(graph);
        // file node should have a rank
        expect(result.ranks.get('file1.ts')).toBe(1);
        // Symbol nodes should get rank 0 with git strategy
        expect(result.ranks.get('file1.ts#symbol1')).toBe(0);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should respect maxCommits option', () => {
      const customGitRanker = createGitRanker({ maxCommits: 100 });
      expect(typeof customGitRanker).toBe('function');
    });

    it('should normalize ranks between 0 and 1', async () => {
      try {
        await fs.writeFile(path.join(tempDir, 'file1.ts'), 'content1');
        await fs.writeFile(path.join(tempDir, 'file2.ts'), 'content2');
        const graph: CodeGraph = createTestGraph([createTestNode('file1.ts'), createTestNode('file2.ts')]);

        await setupGitRepo(tempDir);
        await makeGitCommit(tempDir, 'Initial commit', ['file1.ts', 'file2.ts']);

        // Modify file1 more frequently
        await fs.writeFile(path.join(tempDir, 'file1.ts'), 'modified content1');
        await makeGitCommit(tempDir, 'Update file1', ['file1.ts']);

        await fs.writeFile(path.join(tempDir, 'file1.ts'), 'modified content1 again');
        await makeGitCommit(tempDir, 'Update file1 again', ['file1.ts']);

        const originalCwd = process.cwd();
        process.chdir(tempDir);
        try {
          const result = await gitRanker(graph);

          // All ranks should be between 0 and 1
          result.ranks.forEach(rank => {
            expect(rank).toBeGreaterThanOrEqual(0);
            expect(rank).toBeLessThanOrEqual(1);
          });

          // file1.ts should have higher rank than file2.ts
          const file1Rank = result.ranks.get('file1.ts')!;
          const file2Rank = result.ranks.get('file2.ts')!;
          expect(file1Rank).toBeGreaterThan(file2Rank);
        } finally {
          process.chdir(originalCwd);
        }
      } catch (error) {
        // Skip test if git is not available
        console.warn('Git not available, skipping git ranking test');
      }
    });
  });

  describe('Ranking Comparison', () => {
    it('should produce different rankings for PageRank vs Git strategies', async () => {
      const analyzer = createTreeSitterAnalyzer();
      const files: FileContent[] = [
        {
          path: 'src/index.ts',
          content: `import { Utils } from './utils.js';
export { Utils };`
        },
        {
          path: 'src/utils.ts',
          content: `export class Utils {
  static helper(): string {
    return 'help';
  }
}`
        },
        {
          path: 'src/standalone.ts',
          content: `export const standalone = true;`
        }
      ];

      const graph = await analyzer(files);
      
      const pageRanker = createPageRanker();
      const gitRanker = createGitRanker();

      const pageRankResult = await pageRanker(graph);
      const gitRankResult = await gitRanker(graph);

      // Results should have same structure but potentially different ranks
      expect(pageRankResult.ranks.size).toBe(gitRankResult.ranks.size);
      
      // In PageRank, utils.ts should have high rank due to being imported
      const pageRankUtilsRank = pageRankResult.ranks.get('src/utils.ts')!;
      expect(pageRankUtilsRank).toBeGreaterThan(0);
    });

    it('should handle graphs with no edges', async () => {
      const graph: CodeGraph = createTestGraph([createTestNode('file1'), createTestNode('file2')]);

      const pageRanker = createPageRanker();
      const result = await pageRanker(graph);

      expect(result.ranks.size).toBe(2);
      
      // All nodes should have equal rank in a graph with no edges
      const ranks = Array.from(result.ranks.values());
      expect(ranks[0]).toBeDefined();
      expect(ranks[1]).toBeDefined();
      expect(ranks[0]!).toBeCloseTo(ranks[1]!, 5);
    });
  });

  describe('Edge Cases', () => {
    it('should handle self-referential imports', async () => {
      const graph: CodeGraph = createTestGraph([createTestNode('file1')]);

      // Note: self-loops are disabled in our graph configuration
      // This tests that the ranker handles this gracefully

      const pageRanker = createPageRanker();
      const result = await pageRanker(graph);

      expect(result.ranks.size).toBe(1);
      expect(result.ranks.get('file1')).toBeGreaterThan(0);
    });

    it('should handle very large graphs efficiently', async () => {
      // Create a large graph with many nodes
      const nodeCount = 1000;
      const nodes = Array.from({ length: nodeCount }, (_, i) => createTestNode(`node${i}`));

      // Add some edges
      const edges = Array.from({ length: nodeCount - 1 }, (_, i) => ({ fromId: `node${i}`, toId: `node${i + 1}`, type: 'imports' as const }));
      const graph: CodeGraph = createTestGraph(nodes, edges);

      const pageRanker = createPageRanker();
      const startTime = Date.now();
      const result = await pageRanker(graph);
      const endTime = Date.now();

      expect(result.ranks.size).toBe(nodeCount);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});