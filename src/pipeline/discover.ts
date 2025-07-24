import { globby } from 'globby';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { FileContent, FileDiscoverer } from '../types';
import { isDirectory, readFile } from '../utils/fs.util';
import { FileSystemError } from '../utils/error.util';
import { logger } from '../utils/logger.util';

/**
 * Creates the default file discoverer. It uses globby to find all files,
 * respecting .gitignore patterns and custom include/exclude rules.
 * @returns A FileDiscoverer function.
 */
export const createDefaultDiscoverer = (): FileDiscoverer => {
  return async ({ root, include, ignore: userIgnore, noGitignore = false }) => {
    try {
      if (!(await isDirectory(root))) {
        throw new FileSystemError('Root path is not a directory or does not exist', root);
      }
    } catch (e) {
      throw e;
    }
    const patterns = include && include.length > 0 ? [...include] : ['**/*'];
    
    // Manually build the ignore list to replicate the old logic without the `ignore` package.
    const ignorePatterns = [
      '**/node_modules/**',
      '**/.git/**',
      '.gitignore', // Always ignore the gitignore file itself
    ];

    if (userIgnore && userIgnore.length > 0) {
      ignorePatterns.push(...userIgnore);
    }
    
    if (!noGitignore) {
      try {
        const gitignoreContent = await readFile(path.join(root, '.gitignore'));
        const gitignoreLines = gitignoreContent
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0 && !line.startsWith('#'));
        ignorePatterns.push(...gitignoreLines);
      } catch {
        // .gitignore is optional, so we can ignore errors here.
      }
    }

    // Use globby to find all files, passing our manually constructed ignore list.
    // We set `gitignore: false` because we are handling it ourselves.
    const foundPaths = await globby(patterns, {
      cwd: root,
      gitignore: false, // We handle gitignore patterns manually
      ignore: ignorePatterns,
      dot: true,
      absolute: true,
      followSymbolicLinks: true,
      onlyFiles: true,
    });

    const relativePaths = foundPaths.map(p => path.relative(root, p).replace(/\\/g, '/'));

    // Filter out files that are duplicates via symlinks
    const visitedRealPaths = new Set<string>();
    const safeRelativePaths: string[] = [];
    
    for (const relativePath of relativePaths) {
      const fullPath = path.resolve(root, relativePath);
      try {
        const realPath = await realpath(fullPath);
        if (!visitedRealPaths.has(realPath)) {
          visitedRealPaths.add(realPath);
          safeRelativePaths.push(relativePath);
        }
      } catch (error) {
        // If we can't resolve the real path, skip this file
        logger.debug(`Skipping file due to symlink resolution error: ${relativePath}`);
      }
    }
    
    // The `ignore` option in globby should have already done the filtering.
    const filteredPaths = safeRelativePaths;

    const fileContents = await Promise.all(
      filteredPaths.map(async (relativePath): Promise<FileContent | null> => {
        try {
          const absolutePath = path.join(root, relativePath);
          const content = await readFile(absolutePath);
          return { path: relativePath, content };
        } catch (e) {
          logger.debug(`Skipping file that could not be read: ${relativePath}`, e instanceof Error ? e.message : e);
          return null;
        }
      })
    );

    return fileContents.filter((c): c is FileContent => c !== null);
  };
};