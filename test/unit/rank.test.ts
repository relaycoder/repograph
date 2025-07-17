import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createPageRanker, createGitRanker } from '../../src/pipeline/rank.js';
import {
  createTempDir,
  cleanupTempDir,
  createTestFiles,
  setupGitRepo,
  makeGitCommit,
  createTestGraph,
  createTestNode
} from '../test.util.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('Graph Rankers', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('PageRanker', () => {
    it('should correctly calculate ranks in a graph with disconnected components', async () => {
      const ranker = createPageRanker();
      const graph = createTestGraph(
        [
          // Component 1
          createTestNode('a.ts'),
          createTestNode('b.ts'),
          // Component 2
          createTestNode('c.ts'),
          createTestNode('d.ts'),
        ],
        [
          { fromId: 'a.ts', toId: 'b.ts', type: 'imports' },
          { fromId: 'c.ts', toId: 'd.ts', type: 'imports' }
        ]
      );
      
      const { ranks } = await ranker(graph);
      
      expect(ranks.size).toBe(4);
      expect(ranks.get('a.ts')).toBeDefined();
      expect(ranks.get('b.ts')).toBeDefined();
      expect(ranks.get('c.ts')).toBeDefined();
      expect(ranks.get('d.ts')).toBeDefined();
      // In two identical components, ranks of corresponding nodes should be equal
      expect(ranks.get('b.ts')).toBeCloseTo(ranks.get('d.ts')!);
    });

    it('should rank a central utility file imported by many others higher than leaf files', async () => {
      const ranker = createPageRanker();
      const graph = createTestGraph(
        [
          createTestNode('utils.ts'),
          createTestNode('a.ts'),
          createTestNode('b.ts'),
          createTestNode('c.ts'),
        ],
        [
          { fromId: 'a.ts', toId: 'utils.ts', type: 'imports' },
          { fromId: 'b.ts', toId: 'utils.ts', type: 'imports' },
          { fromId: 'c.ts', toId: 'utils.ts', type: 'imports' },
        ]
      );
      
      const { ranks } = await ranker(graph);
      const utilRank = ranks.get('utils.ts')!;
      const aRank = ranks.get('a.ts')!;
      
      expect(utilRank).toBeGreaterThan(aRank);
    });
  });

  describe('GitRanker', () => {
    let originalCwd: string;

    beforeEach(() => {
      originalCwd = process.cwd();
      process.chdir(tempDir);
    });

    afterEach(() => {
      process.chdir(originalCwd);
    });

    it('should assign a rank of zero to files that have no commits in git history', async () => {
      await setupGitRepo(tempDir);
      await createTestFiles(tempDir, {
        'committed.ts': 'export const a = 1;',
        'uncommitted.ts': 'export const b = 2;'
      });
      await makeGitCommit(tempDir, 'Initial commit', ['committed.ts']);
      
      const graph = createTestGraph([
        createTestNode('committed.ts'),
        createTestNode('uncommitted.ts')
      ]);

      const ranker = createGitRanker();
      const { ranks } = await ranker(graph);

      expect(ranks.get('committed.ts')).toBeGreaterThan(0);
      expect(ranks.get('uncommitted.ts')).toBe(0);
    });

    it('should correctly rank files when the git history contains file renames', async () => {
      await setupGitRepo(tempDir);
      
      // Commit 1: Create original file
      await createTestFiles(tempDir, { 'original.ts': 'let a = 1;' });
      await makeGitCommit(tempDir, 'feat: create original');
      
      // Commit 2: Rename and modify
      await fs.rename(path.join(tempDir, 'original.ts'), path.join(tempDir, 'renamed.ts'));
      await createTestFiles(tempDir, { 'renamed.ts': 'let a = 1; let b = 2;' });
      await makeGitCommit(tempDir, 'refactor: rename and modify', ['renamed.ts']);
      
      // Commit 3: Modify again
      await createTestFiles(tempDir, { 'renamed.ts': 'let a = 1; let b = 2; let c = 3;' });
      await makeGitCommit(tempDir, 'feat: add c', ['renamed.ts']);
      
      const graph = createTestGraph([createTestNode('renamed.ts')]);
      const ranker = createGitRanker();
      const { ranks } = await ranker(graph);
      
      // The rank should reflect all 3 commits, including history from before the rename.
      // A rank of 1.0 indicates it has been part of every commit.
      expect(ranks.get('renamed.ts')).toBe(1.0);
    });
  });
});