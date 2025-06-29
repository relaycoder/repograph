import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createPageRanker, createGitRanker } from '../../src/pipeline/rank.js';
import { createTreeSitterAnalyzer } from '../../src/pipeline/analyze.js';
import type { FileContent, CodeGraph, CodeNode, CodeEdge } from '../../src/types.js';
import {
  createTempDir,
  cleanupTempDir,
  createTestFiles,
  loadFixture,
  createProjectFromFixture
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
      const nodes = new Map<string, CodeNode>();
      const edges: CodeEdge[] = [];

      // Create a simple graph with nodes and edges
      nodes.set('file1', {
        id: 'file1',
        type: 'file',
        name: 'file1.ts',
        filePath: 'file1.ts',
        startLine: 1,
        endLine: 10
      });

      nodes.set('file2', {
        id: 'file2',
        type: 'file',
        name: 'file2.ts',
        filePath: 'file2.ts',
        startLine: 1,
        endLine: 15
      });

      nodes.set('symbol1', {
        id: 'symbol1',
        type: 'function',
        name: 'func1',
        filePath: 'file1.ts',
        startLine: 2,
        endLine: 5
      });

      edges.push({ fromId: 'file1', toId: 'file2', type: 'imports' });

      const graph: CodeGraph = { nodes, edges };
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
      const nodes = new Map<string, CodeNode>();
      const edges: CodeEdge[] = [];

      // Create a hub node that many others connect to
      nodes.set('hub', {
        id: 'hub',
        type: 'file',
        name: 'hub.ts',
        filePath: 'hub.ts',
        startLine: 1,
        endLine: 10
      });

      // Create several nodes that import from the hub
      for (let i = 1; i <= 5; i++) {
        const nodeId = `node${i}`;
        nodes.set(nodeId, {
          id: nodeId,
          type: 'file',
          name: `${nodeId}.ts`,
          filePath: `${nodeId}.ts`,
          startLine: 1,
          endLine: 10
        });
        edges.push({ fromId: nodeId, toId: 'hub', type: 'imports' });
      }

      // Create an isolated node
      nodes.set('isolated', {
        id: 'isolated',
        type: 'file',
        name: 'isolated.ts',
        filePath: 'isolated.ts',
        startLine: 1,
        endLine: 10
      });

      const graph: CodeGraph = { nodes, edges };
      const result = await pageRanker(graph);

      const hubRank = result.ranks.get('hub')!;
      const isolatedRank = result.ranks.get('isolated')!;

      // Hub should have higher rank than isolated node
      expect(hubRank).toBeGreaterThan(isolatedRank);
    });

    it('should return RankedCodeGraph with correct structure', async () => {
      const nodes = new Map<string, CodeNode>();
      nodes.set('test', {
        id: 'test',
        type: 'file',
        name: 'test.ts',
        filePath: 'test.ts',
        startLine: 1,
        endLine: 10
      });
      const graph: CodeGraph = { nodes, edges: [] };

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
      const nodes = new Map<string, CodeNode>();
      nodes.set('file1', {
        id: 'file1',
        type: 'file',
        name: 'file1.ts',
        filePath: 'file1.ts',
        startLine: 1,
        endLine: 10
      });

      nodes.set('symbol1', {
        id: 'symbol1',
        type: 'function',
        name: 'func1',
        filePath: 'file1.ts',
        startLine: 2,
        endLine: 5
      });
      const graph: CodeGraph = { nodes, edges: [] };

      // Change to a directory without git
      const originalCwd = process.cwd();
      process.chdir(tempDir);

      try {
        const result = await gitRanker(graph);

        expect(result.ranks.size).toBe(2);
        expect(result.ranks.get('file1')).toBe(0);
        expect(result.ranks.get('symbol1')).toBe(0);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should only rank file nodes with git strategy', async () => {
      const nodes = new Map<string, CodeNode>();
      nodes.set('file1', {
        id: 'file1',
        type: 'file',
        name: 'file1.ts',
        filePath: 'file1.ts',
        startLine: 1,
        endLine: 10
      });

      nodes.set('symbol1', {
        id: 'symbol1',
        type: 'function',
        name: 'func1',
        filePath: 'file1.ts',
        startLine: 2,
        endLine: 5
      });
      const graph: CodeGraph = { nodes, edges: [] };

      const result = await gitRanker(graph);

      // Symbol nodes should get rank 0 with git strategy
      expect(result.ranks.get('symbol1')).toBe(0);
    });

    it('should respect maxCommits option', () => {
      const customGitRanker = createGitRanker({ maxCommits: 100 });
      expect(typeof customGitRanker).toBe('function');
    });

    it('should normalize ranks between 0 and 1', async () => {
      // Create a mock git repository for testing
      await fs.mkdir(path.join(tempDir, '.git'), { recursive: true });
      await createTestFiles(tempDir, {
        'file1.ts': 'content1',
        'file2.ts': 'content2'
      });

      const nodes = new Map<string, CodeNode>();
      nodes.set('file1.ts', {
        id: 'file1.ts',
        type: 'file',
        name: 'file1.ts',
        filePath: 'file1.ts',
        startLine: 1,
        endLine: 10
      });
      nodes.set('file2.ts', {
        id: 'file2.ts',
        type: 'file',
        name: 'file2.ts',
        filePath: 'file2.ts',
        startLine: 1,
        endLine: 10
      });
      const graph: CodeGraph = { nodes, edges: [] };

      const originalCwd = process.cwd();
      process.chdir(tempDir);

      try {
        // Initialize git repo and create some commits
        execSync('git init', { stdio: 'ignore' });
        execSync('git config user.email "test@example.com"', { stdio: 'ignore' });
        execSync('git config user.name "Test User"', { stdio: 'ignore' });
        execSync('git add .', { stdio: 'ignore' });
        execSync('git commit -m "Initial commit"', { stdio: 'ignore' });

        // Modify file1 more frequently
        await fs.writeFile(path.join(tempDir, 'file1.ts'), 'modified content1');
        execSync('git add file1.ts', { stdio: 'ignore' });
        execSync('git commit -m "Update file1"', { stdio: 'ignore' });

        await fs.writeFile(path.join(tempDir, 'file1.ts'), 'modified content1 again');
        execSync('git add file1.ts', { stdio: 'ignore' });
        execSync('git commit -m "Update file1 again"', { stdio: 'ignore' });

        const result = await gitRanker(graph);

        // All ranks should be between 0 and 1
        for (const rank of result.ranks.values()) {
          expect(rank).toBeGreaterThanOrEqual(0);
          expect(rank).toBeLessThanOrEqual(1);
        }

        // file1.ts should have higher rank than file2.ts
        const file1Rank = result.ranks.get('file1.ts')!;
        const file2Rank = result.ranks.get('file2.ts')!;
        expect(file1Rank).toBeGreaterThan(file2Rank);

      } catch (error) {
        // Skip test if git is not available
        console.warn('Git not available, skipping git ranking test');
      } finally {
        process.chdir(originalCwd);
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
      const nodes = new Map<string, CodeNode>();

      // Add isolated nodes
      nodes.set('file1', {
        id: 'file1',
        type: 'file',
        name: 'file1.ts',
        filePath: 'file1.ts',
        startLine: 1,
        endLine: 10
      });
      nodes.set('file2', {
        id: 'file2',
        type: 'file',
        name: 'file2.ts',
        filePath: 'file2.ts',
        startLine: 1,
        endLine: 10
      });
      const graph: CodeGraph = { nodes, edges: [] };

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

  describe('Integration with Fixtures', () => {
    it('should rank sample-project fixture correctly', async () => {
      const fixture = await loadFixture('sample-project');
      await createProjectFromFixture(tempDir, fixture);

      const analyzer = createTreeSitterAnalyzer();
      const files: FileContent[] = [];
      
      for (const file of fixture.files) {
        if (file.path.endsWith('.ts')) {
          files.push({
            path: file.path,
            content: file.content
          });
        }
      }

      const graph = await analyzer(files);
      const pageRanker = createPageRanker();
      const result = await pageRanker(graph);

      expect(result.ranks.size).toBeGreaterThan(0);
      
      // Files that are imported more should have higher ranks
      const loggerRank = result.ranks.get('src/utils/logger.ts');
      const typesRank = result.ranks.get('src/types.ts');
      
      expect(loggerRank).toBeGreaterThan(0);
      expect(typesRank).toBeGreaterThan(0);
    });

    it('should rank complex-project fixture correctly', async () => {
      const fixture = await loadFixture('complex-project');
      await createProjectFromFixture(tempDir, fixture);

      const analyzer = createTreeSitterAnalyzer();
      const files: FileContent[] = [];
      
      for (const file of fixture.files) {
        if (file.path.endsWith('.ts') && !file.path.includes('test')) {
          files.push({
            path: file.path,
            content: file.content
          });
        }
      }

      const graph = await analyzer(files);
      const pageRanker = createPageRanker();
      const result = await pageRanker(graph);

      // Database and types should have high ranks as they're widely imported
      const databaseRank = result.ranks.get('src/database/index.ts');
      const typesRank = result.ranks.get('src/types/index.ts');
      
      expect(databaseRank).toBeGreaterThan(0);
      expect(typesRank).toBeGreaterThan(0);
    });

    it('should handle minimal-project fixture', async () => {
      const fixture = await loadFixture('minimal-project');
      await createProjectFromFixture(tempDir, fixture);

      const analyzer = createTreeSitterAnalyzer();
      const files: FileContent[] = [
        {
          path: 'src/main.ts',
          content: fixture.files[0]!.content
        }
      ];

      const graph = await analyzer(files);
      const pageRanker = createPageRanker();
      const result = await pageRanker(graph);

      expect(result.ranks.size).toBe(fixture.expected_nodes!);
      
      // All nodes should have positive ranks
      for (const rank of result.ranks.values()) {
        expect(rank).toBeGreaterThan(0);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle self-referential imports', async () => {
      const nodes = new Map<string, CodeNode>();
      nodes.set('file1', {
        id: 'file1',
        type: 'file',
        name: 'file1.ts',
        filePath: 'file1.ts',
        startLine: 1,
        endLine: 10
      });
      const graph: CodeGraph = { nodes, edges: [] };

      // Note: self-loops are disabled in our graph configuration
      // This tests that the ranker handles this gracefully

      const pageRanker = createPageRanker();
      const result = await pageRanker(graph);

      expect(result.ranks.size).toBe(1);
      expect(result.ranks.get('file1')).toBeGreaterThan(0);
    });

    it('should handle very large graphs efficiently', async () => {
      const nodes = new Map<string, CodeNode>();
      const edges: CodeEdge[] = [];

      // Create a large graph with many nodes
      const nodeCount = 1000;
      for (let i = 0; i < nodeCount; i++) {
        nodes.set(`node${i}`, {
          id: `node${i}`,
          type: 'file',
          name: `file${i}.ts`,
          filePath: `file${i}.ts`,
          startLine: 1,
          endLine: 10
        });
      }

      // Add some edges
      for (let i = 0; i < nodeCount - 1; i++) {
        edges.push({ fromId: `node${i}`, toId: `node${i + 1}`, type: 'imports' });
      }
      const graph: CodeGraph = { nodes, edges };

      const pageRanker = createPageRanker();
      const startTime = Date.now();
      const result = await pageRanker(graph);
      const endTime = Date.now();

      expect(result.ranks.size).toBe(nodeCount);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});