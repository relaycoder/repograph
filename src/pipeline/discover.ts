import { globby } from 'globby';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import Ignore from 'ignore';
import type { FileContent, FileDiscoverer } from '../types.js';
import { isDirectory, readFile } from '../utils/fs.util.js';
import { FileSystemError } from '../utils/error.util.js';
import { logger } from '../utils/logger.util.js';

/**
 * Creates the default file discoverer. It uses globby to find all files,
 * respecting .gitignore patterns and custom include/exclude rules.
 * @returns A FileDiscoverer function.
 */
export const createDefaultDiscoverer = (): FileDiscoverer => {
  return async ({ root, include, ignore, noGitignore = false }) => {
    try {
      if (!(await isDirectory(root))) {
        throw new FileSystemError('Root path is not a directory or does not exist', root);
      }
    } catch (e) {
      throw e;
    }
    const patterns = include && include.length > 0 ? [...include] : ['**/*'];
    
    // Use the ignore package for proper gitignore handling
    const ignoreFilter = Ignore();
    
    // Always ignore node_modules and .git
    ignoreFilter.add('**/node_modules/**');
    ignoreFilter.add('**/.git/**');
    ignoreFilter.add('.gitignore');
    
    // Add .gitignore patterns if not disabled
    if (!noGitignore) {
      let gitignoreContent = '';
      try {
        gitignoreContent = await readFile(path.join(root, '.gitignore'));
      } catch {
        // .gitignore is optional, so we can ignore errors here.
      }
      if (gitignoreContent) {
        ignoreFilter.add(gitignoreContent);
      }
    }
    
    // Add user-specified ignore patterns
    if (ignore && ignore.length > 0) {
      ignoreFilter.add(ignore.join('\n'));
    }

    // Use globby to find all files matching the include patterns.
    // Globby might return absolute paths if the patterns are absolute. We ensure
    // all paths are absolute first, then make them relative to the root for
    // consistent processing, which is required by the `ignore` package.
    const foundPaths = await globby(patterns, {
      cwd: root,
      gitignore: false, // We handle gitignore patterns manually
      dot: true,
      absolute: true,
      followSymbolicLinks: true,
      onlyFiles: true,
    });

    const relativePaths = foundPaths.map(p => path.relative(root, p).replace(/\\/g, '/'));

    // Filter out files that would cause symlink cycles
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
    
    // Filter the paths using the ignore package. Paths are now guaranteed to be relative.
    const filteredPaths = safeRelativePaths.filter(p => !ignoreFilter.ignores(p));

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