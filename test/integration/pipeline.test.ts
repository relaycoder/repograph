import { describe, it, expect } from 'bun:test';
import { generateMap } from '../../src/high-level.js';
import {
  createTempDir,
  cleanupTempDir,
  createTestFiles,
  createGitignore,
  assertFileExists,
  readFile,
  isValidMarkdown,
  containsValidMermaid,
  loadFixture,
  createProjectFromFixture,
  runRepoGraphForTests
} from '../test.util.js';
import path from 'node:path';

describe('Pipeline Integration', () => {
  it('should execute complete pipeline with default components', async () => {
    const files = {
      'src/index.ts': `import { Calculator } from './calculator.js'; export { Calculator };`,
      'src/calculator.ts': `export class Calculator { add(a, b) { return a + b; } }`
    };
    const content = await runRepoGraphForTests(files, { include: ['**/*.ts'] });
    
    expect(isValidMarkdown(content)).toBe(true);
    expect(content).toContain('Calculator');
    expect(containsValidMermaid(content)).toBe(true);
  });

  it('should handle empty project gracefully', async () => {
    const content = await runRepoGraphForTests({});
    expect(isValidMarkdown(content)).toBe(true);
    expect(content).toContain('This repository contains 0 nodes (0 files)');
  });

  it('should respect include patterns', async () => {
    const files = {
      'src/index.ts': 'export const ts = true;',
      'src/index.js': 'export const js = true;',
    };
    const content = await runRepoGraphForTests(files, { include: ['**/*.ts'] });
    expect(content).toContain('src/index.ts');
    expect(content).not.toContain('src/index.js');
  });

  it('should respect ignore patterns', async () => {
    const files = {
      'src/index.ts': 'export const main = true;',
      'src/test.spec.ts': 'test code',
    };
    const content = await runRepoGraphForTests(files, { ignore: ['**/*.spec.ts'] });
    expect(content).toContain('src/index.ts');
    expect(content).not.toContain('src/test.spec.ts');
  });

  it('should respect gitignore by default', async () => {
    const tempDir = await createTempDir();
    try {
      await createTestFiles(tempDir, {
        'src/index.ts': 'export const main = true;',
        'dist/index.js': 'compiled code',
      });
      await createGitignore(tempDir, ['dist/']);

      const outputPath = path.join(tempDir, 'output.md');
      await generateMap({ root: tempDir, output: outputPath });
      const content = await readFile(outputPath);

      expect(content).toContain('src/index.ts');
      expect(content).not.toContain('dist/index.js');
    } finally {
      await cleanupTempDir(tempDir);
    }
  });

  it('should create output directory if it does not exist', async () => {
    const tempDir = await createTempDir();
    try {
      await createTestFiles(tempDir, { 'src/index.ts': 'export const test = true;' });
      const outputPath = path.join(tempDir, 'nested', 'deep', 'output.md');
      await generateMap({ root: tempDir, output: outputPath });
      await assertFileExists(outputPath);
    } finally {
      await cleanupTempDir(tempDir);
    }
  });

  it('should pass renderer options through pipeline', async () => {
    const files = {
      'src/index.ts': `export function main() {}`,
    };
    const content = await runRepoGraphForTests(files, {
      rendererOptions: {
        includeHeader: false,
        includeOverview: false,
        includeMermaidGraph: false,
        includeFileList: false,
        includeSymbolDetails: false,
      }
    });
    expect(content).toBe('');
  });

  it('should work with Git ranking strategy', async () => {
    const files = {
      'src/index.ts': 'export const main = true;',
      'src/utils.ts': 'export const util = true;',
    };
    const content = await runRepoGraphForTests(files, { rankingStrategy: 'git-changes' });
    expect(isValidMarkdown(content)).toBe(true);
    expect(content).toContain('src/index.ts');
    expect(content).toContain('src/utils.ts');
  });

  it('should handle circular dependencies gracefully', async () => {
    const files = {
      'src/a.ts': `import { B } from './b.js'; export class A {}`,
      'src/b.ts': `import { A } from './a.js'; export class B {}`,
    };
    const content = await runRepoGraphForTests(files);
    expect(content).toContain('src/a.ts');
    expect(content).toContain('src/b.ts');
    expect(containsValidMermaid(content)).toBe(true);
  });

  describe('Integration with Fixtures', () => {
    it('should process sample-project fixture end-to-end', async () => {
      const fixture = await loadFixture('sample-project');
      const tempDir = await createTempDir();
      try {
        await createProjectFromFixture(tempDir, fixture);
        const outputPath = path.join(tempDir, 'output.md');
        await generateMap({
          root: tempDir,
          output: outputPath,
          include: ['**/*.ts']
        });
        const content = await readFile(outputPath);
        
        expect(isValidMarkdown(content)).toBe(true);
        expect(content).toContain('Calculator');
        expect(content).toContain('Logger');
        expect(content).toContain('AdvancedCalculator');
        expect(containsValidMermaid(content)).toBe(true);
      } finally {
        await cleanupTempDir(tempDir);
      }
    });

    it('should process complex-project fixture end-to-end', async () => {
      const fixture = await loadFixture('complex-project');
       const tempDir = await createTempDir();
      try {
        await createProjectFromFixture(tempDir, fixture);
        const outputPath = path.join(tempDir, 'output.md');
        await generateMap({
          root: tempDir,
          output: outputPath,
          include: ['**/*.ts']
        });
        const content = await readFile(outputPath);
        
        expect(isValidMarkdown(content)).toBe(true);
        expect(content).toContain('Database');
        expect(content).toContain('ApiServer');
        expect(content).toContain('UserService');
        expect(containsValidMermaid(content)).toBe(true);
        expect(content).not.toContain('tests/user.test.ts');
      } finally {
        await cleanupTempDir(tempDir);
      }
    });
  });
});