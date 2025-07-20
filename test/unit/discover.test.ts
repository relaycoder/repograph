import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createDefaultDiscoverer } from '../../src/pipeline/discover.js';
import {
  createTempDir,
  cleanupTempDir,
  createTestFiles,
  createSymlink,
} from '../test.util.js';
import path from 'node:path';

describe('File Discoverer: createDefaultDiscoverer()', () => {
  let tempDir: string;
  let discoverer: ReturnType<typeof createDefaultDiscoverer>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    discoverer = createDefaultDiscoverer();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('should resolve and normalize paths relative to the provided root directory', async () => {
    const files = {
      'src/components/button.ts': 'export const Button = {};',
      'src/utils/math/add.ts': 'export const add = (a, b) => a + b;',
    };
    await createTestFiles(tempDir, files);

    const discoveredFiles = await discoverer({ root: tempDir });
    const discoveredPaths = discoveredFiles.map(f => f.path).sort();

    expect(discoveredPaths).toEqual([
      'src/components/button.ts',
      'src/utils/math/add.ts',
    ]);
  });

  it('should correctly handle discovering files within a directory that is a symbolic link', async () => {
    try {
      // This test might be skipped on Windows if symlinks can't be created
      const linkedDir = path.join(tempDir, 'linked-dir');
      const symlinkPath = path.join(tempDir, 'src', 'symlink');
      
      await createTestFiles(linkedDir, { 'service.ts': 'export class Service {}' });
      await createSymlink(linkedDir, symlinkPath);

      await createTestFiles(tempDir, { 'src/main.ts': `import { Service } from './symlink/service';` });

      const discoveredFiles = await discoverer({ root: path.join(tempDir, 'src') });
      const discoveredPaths = discoveredFiles.map(f => f.path).sort();
      
      // The discoverer should resolve the symlink and find the file within it.
      const expectedPaths = [
        'main.ts',
        'symlink/service.ts'
      ].sort();

      expect(discoveredPaths).toEqual(expectedPaths);
    } catch (error) {
      if (error instanceof Error && (error.message.includes('EPERM') || error.message.includes('operation not permitted'))) {
        console.warn('Skipping symlink test: insufficient permissions to create symlinks');
        return; // Skip this test on systems without symlink permissions
      }
      throw error;
    }
  });

  it('should not get stuck in a recursive loop when a symbolic link points to a parent directory', async () => {
    try {
      const subDir = path.join(tempDir, 'sub');
      const symlinkPath = path.join(subDir, 'link-to-parent');
      
      await createTestFiles(tempDir, { 'root.ts': 'export const root = true;' });
      await createTestFiles(subDir, { 'child.ts': 'export const child = true;' });
      
      // Create a symlink from 'sub/link-to-parent' to '.' (tempDir)
      await createSymlink(tempDir, symlinkPath);

      // The discoverer should complete without throwing a 'too many open files' error or timing out.
      const discoveredFiles = await discoverer({ root: tempDir });
      const discoveredPaths = discoveredFiles.map(f => f.path).sort();

      expect(discoveredPaths).toEqual([
          'root.ts',
          'sub/child.ts',
      ].sort());
    } catch (error) {
      if (error instanceof Error && (error.message.includes('EPERM') || error.message.includes('operation not permitted'))) {
        console.warn('Skipping symlink test: insufficient permissions to create symlinks');
        return; // Skip this test on systems without symlink permissions
      }
      throw error;
    }
  });
});