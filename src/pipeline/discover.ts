import { globby } from 'globby';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { FileContent, FileDiscoverer } from 'repograph-core';
import { logger, FileSystemError } from 'repograph-core';
import { isDirectory, readFile } from '../utils/fs.util';

/**
 * Creates the default file discoverer. It uses globby to find all files,
 * respecting .gitignore patterns and custom include/exclude rules.
 * @returns A FileDiscoverer function.
 */
export const createDefaultDiscoverer = (): FileDiscoverer => {
  return async ({ root, include, ignore: userIgnore, noGitignore = false }) => {
    if (!(await isDirectory(root))) {
      throw new FileSystemError('Root path is not a directory or does not exist', root);
    }

    const patterns = include && include.length > 0 ? [...include] : ['**/*'];
    
    const foundPaths = await globby(patterns, {
      cwd: root,
      gitignore: !noGitignore,
      ignore: [...(userIgnore || [])],
      dot: true,
      absolute: true,
      onlyFiles: true,
      followSymbolicLinks: true, // Follow symlinks to find all possible files
    });

    const relativePaths = foundPaths.map(p => path.relative(root, p).replace(/\\/g, '/'));

    // Filter out files that are duplicates via symlinks by checking their real path
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
        logger.debug(`Skipping file due to symlink resolution error: ${relativePath}`);
      }
    }

    const fileContents = await Promise.all(
      safeRelativePaths.map(async (relativePath): Promise<FileContent | null> => {
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