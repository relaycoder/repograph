import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createDefaultDiscoverer } from '../../src/pipeline/discover.js';
import {
  createTempDir,
  cleanupTempDir,
  createTestFiles,
  createGitignore,
  loadFixture,
  createProjectFromFixture,
  createSymlink
} from '../test.util.js';
import path from 'node:path';
import fs from 'node:fs/promises';

describe('File Discovery', () => {
  let tempDir: string;
  let discoverer: ReturnType<typeof createDefaultDiscoverer>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    discoverer = createDefaultDiscoverer();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('createDefaultDiscoverer()', () => {
    it('should return a FileDiscoverer function', () => {
      expect(typeof discoverer).toBe('function');
    });

    it('should discover files using default patterns when no include patterns provided', async () => {
      const files = {
        'src/index.ts': 'export const hello = "world";',
        'src/utils.ts': 'export const util = () => {};',
        'README.md': '# Test Project'
      };
      await createTestFiles(tempDir, files);

      const result = await discoverer({
        root: tempDir
      });

      expect(result.length).toBe(3);
      expect(result.map(f => f.path).sort()).toEqual([
        'README.md',
        'src/index.ts',
        'src/utils.ts'
      ]);
    });

    it('should respect custom include patterns when provided', async () => {
      const files = {
        'src/index.ts': 'export const hello = "world";',
        'src/utils.js': 'export const util = () => {};',
        'README.md': '# Test Project',
        'package.json': '{"name": "test"}'
      };
      await createTestFiles(tempDir, files);

      const result = await discoverer({
        root: tempDir,
        include: ['**/*.ts']
      });

      expect(result).toHaveLength(1);
      expect(result[0]!.path).toBe('src/index.ts');
    });

    it('should exclude files matching ignore patterns', async () => {
      const files = {
        'src/index.ts': 'export const hello = "world";',
        'src/test.spec.ts': 'test code',
        'src/utils.ts': 'export const util = () => {};'
      };
      await createTestFiles(tempDir, files);

      const result = await discoverer({
        root: tempDir,
        ignore: ['**/*.spec.ts']
      });

      expect(result).toHaveLength(2);
      expect(result.map(f => f.path).sort()).toEqual([
        'src/index.ts',
        'src/utils.ts'
      ]);
    });

    it('should respect .gitignore by default', async () => {
      const files = {
        'src/index.ts': 'export const hello = "world";',
        'dist/index.js': 'compiled code',
        'node_modules/package/index.js': 'dependency',
        '.env': 'SECRET=value'
      };
      await createTestFiles(tempDir, files);
      await createGitignore(tempDir, ['dist/', '.env']);

      const result = await discoverer({
        root: tempDir
      });

      expect(result).toHaveLength(1);
      expect(result[0]!.path).toBe('src/index.ts');
    });

    it('should ignore .gitignore when noGitignore is true', async () => {
      const files = {
        'src/index.ts': 'export const hello = "world";',
        'dist/index.js': 'compiled code',
        '.env': 'SECRET=value'
      };
      await createTestFiles(tempDir, files);
      await createGitignore(tempDir, ['dist/', '.env']);

      const result = await discoverer({
        root: tempDir,
        noGitignore: true
      });

      expect(result).toHaveLength(3);
      expect(result.map(f => f.path).sort()).toEqual([
        '.env',
        'dist/index.js',
        'src/index.ts'
      ]);
    });

    it('should always exclude node_modules directory', async () => {
      const files = {
        'src/index.ts': 'export const hello = "world";',
        'node_modules/package/index.js': 'dependency code'
      };
      await createTestFiles(tempDir, files);

      const result = await discoverer({
        root: tempDir,
        noGitignore: true
      });

      expect(result).toHaveLength(1);
      expect(result[0]!.path).toBe('src/index.ts');
    });

    it('should handle non-existent root directory gracefully', async () => {
      const nonExistentDir = path.join(tempDir, 'non-existent');

      await expect(discoverer({
        root: nonExistentDir
      })).rejects.toThrow();
    });

    it('should filter out binary files that cannot be read', async () => {
      const files = {
        'src/index.ts': 'export const hello = "world";',
        'README.md': '# Test Project'
      };
      await createTestFiles(tempDir, files);

      // Create a binary file by writing raw bytes
      const binaryPath = path.join(tempDir, 'binary.bin');
      await fs.writeFile(binaryPath, Buffer.from([0x00, 0x01, 0x02, 0x03]));

      const result = await discoverer({
        root: tempDir
      });

      // Should only include text files
      expect(result).toHaveLength(2);
      expect(result.map(f => f.path).sort()).toEqual([
        'README.md',
        'src/index.ts'
      ]);
    });

    it('should return FileContent objects with correct path and content properties', async () => {
      const files = {
        'src/index.ts': 'export const hello = "world";'
      };
      await createTestFiles(tempDir, files);

      const result = await discoverer({
        root: tempDir
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toBeDefined();
      expect(result[0]!).toHaveProperty('path');
      expect(result[0]!).toHaveProperty('content');
      expect(result[0]!.path).toBe('src/index.ts');
      expect(result[0]!.content).toBe('export const hello = "world";');
    });

    it('should handle empty directories', async () => {
      // Create an empty directory structure
      await fs.mkdir(path.join(tempDir, 'empty-dir'), { recursive: true });

      const result = await discoverer({
        root: tempDir
      });

      expect(result.length).toBe(0);
    });

    it('should handle symbolic links appropriately', async () => {
      const files = {
        'src/index.ts': 'export const hello = "world";',
        'target.ts': 'export const target = true;'
      };
      await createTestFiles(tempDir, files);

      // Create a symbolic link
      const linkPath = path.join(tempDir, 'link.ts');
      const targetPath = path.join(tempDir, 'target.ts');
      await createSymlink(targetPath, linkPath);

      const result = await discoverer({
        root: tempDir
      });

      // Should include both original files and potentially the symlink
      expect(result.length).toBeGreaterThanOrEqual(2);
      const paths = result.map(f => f.path);
      expect(paths).toContain('src/index.ts');
      expect(paths).toContain('target.ts');
    });

    it('should normalize file paths consistently across platforms', async () => {
      const files = {
        'src/nested/deep/index.ts': 'export const hello = "world";'
      };
      await createTestFiles(tempDir, files);

      const result = await discoverer({
        root: tempDir
      });

      expect(result).toHaveLength(1);
      // Path should use forward slashes regardless of platform
      expect(result[0]!.path).toBe('src/nested/deep/index.ts');
    });
  });

  describe('Gitignore Integration', () => {
    it('should read .gitignore file when present', async () => {
      const files = {
        'src/index.ts': 'export const hello = "world";',
        'build/output.js': 'compiled code',
        'logs/app.log': 'log content'
      };
      await createTestFiles(tempDir, files);
      await createGitignore(tempDir, ['build/', 'logs/']);

      const result = await discoverer({
        root: tempDir
      });

      expect(result).toHaveLength(1);
      expect(result[0]!.path).toBe('src/index.ts');
    });

    it('should handle missing .gitignore file gracefully', async () => {
      const files = {
        'src/index.ts': 'export const hello = "world";'
      };
      await createTestFiles(tempDir, files);

      const result = await discoverer({
        root: tempDir
      });

      expect(result).toHaveLength(1);
      expect(result[0]!.path).toBe('src/index.ts');
    });

    it('should combine .gitignore patterns with ignore option', async () => {
      const files = {
        'src/index.ts': 'export const hello = "world";',
        'build/output.js': 'compiled code',
        'test/spec.ts': 'test code',
        'docs/readme.md': 'documentation'
      };
      await createTestFiles(tempDir, files);
      await createGitignore(tempDir, ['build/']);

      const result = await discoverer({
        root: tempDir,
        ignore: ['test/', 'docs/']
      });

      expect(result).toHaveLength(1);
      expect(result[0]!.path).toBe('src/index.ts');
    });

    it('should handle complex .gitignore patterns', async () => {
      const files = {
        'src/index.ts': 'export const hello = "world";',
        'src/temp.tmp': 'temporary file',
        'config/dev.env': 'dev config',
        'config/prod.env': 'prod config',
        'logs/2023.log': 'old log',
        'logs/current.log': 'current log'
      };
      await createTestFiles(tempDir, files);
      await createGitignore(tempDir, [
        '*.tmp',
        '*.env',
        'logs/*.log',
        '!logs/current.log'
      ]);

      const result = await discoverer({
        root: tempDir
      });

      expect(result).toHaveLength(2);
      const paths = result.map(f => f.path).sort();
      expect(paths).toEqual(['logs/current.log', 'src/index.ts']);
    });
  });

  describe('Pattern Matching', () => {
    it('should support glob patterns in include option', async () => {
      const files = {
        'src/index.ts': 'typescript',
        'src/utils.js': 'javascript',
        'tests/spec.ts': 'test typescript',
        'docs/readme.md': 'markdown'
      };
      await createTestFiles(tempDir, files);

      const result = await discoverer({
        root: tempDir,
        include: ['src/**/*.ts', 'tests/**/*.ts']
      });

      expect(result).toHaveLength(2);
      const paths = result.map(f => f.path).sort();
      expect(paths).toEqual(['src/index.ts', 'tests/spec.ts']);
    });

    it('should support glob patterns in ignore option', async () => {
      const files = {
        'src/index.ts': 'typescript',
        'src/test.spec.ts': 'test file',
        'src/utils.test.ts': 'test file',
        'src/helper.ts': 'helper file'
      };
      await createTestFiles(tempDir, files);

      const result = await discoverer({
        root: tempDir,
        ignore: ['**/*.spec.ts', '**/*.test.ts']
      });

      expect(result).toHaveLength(2);
      const paths = result.map(f => f.path).sort();
      expect(paths).toEqual(['src/helper.ts', 'src/index.ts']);
    });

    it('should handle dot files correctly', async () => {
      const files = {
        'src/index.ts': 'typescript',
        '.env': 'environment',
        '.gitignore': 'git ignore',
        '.hidden/file.ts': 'hidden typescript'
      };
      await createTestFiles(tempDir, files);

      const result = await discoverer({
        root: tempDir
      });

      expect(result).toHaveLength(4);
      const paths = result.map(f => f.path).sort();
      expect(paths).toEqual(['.env', '.gitignore', '.hidden/file.ts', 'src/index.ts']);
    });
  });

  describe('Integration with Fixtures', () => {
    it('should work with sample-project fixture', async () => {
      const fixture = await loadFixture('sample-project');
      await createProjectFromFixture(tempDir, fixture);

      const result = await discoverer({
        root: tempDir,
        include: ['**/*.ts']
      });

      expect(result.length).toBe(fixture.expected_files!);
      
      // Verify all TypeScript files are discovered
      const tsFiles = result.filter(f => f.path.endsWith('.ts'));
      expect(tsFiles.length).toBe(fixture.expected_files!);
    });

    it('should work with minimal-project fixture', async () => {
      const fixture = await loadFixture('minimal-project');
      await createProjectFromFixture(tempDir, fixture);

      const result = await discoverer({
        root: tempDir,
        include: ['**/*.ts']
      });

      expect(result.length).toBe(fixture.expected_files!);
      expect(result[0]).toBeDefined();
      expect(result[0]!.path).toBe('src/main.ts');
      expect(result[0]!.content).toContain('export function hello()');
    });

    it('should respect gitignore from complex-project fixture', async () => {
      const fixture = await loadFixture('complex-project');
      await createProjectFromFixture(tempDir, fixture);

      const result = await discoverer({
        root: tempDir,
        include: ['**/*.ts']
      });

      // Should exclude test files due to gitignore
      expect(result.length).toBe(fixture.expected_files!);
      const paths = result.map(f => f.path);
      expect(paths).not.toContain('tests/user.test.ts');
    });
  });
});