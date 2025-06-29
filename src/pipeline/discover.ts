import { globby } from 'globby';
import path from 'node:path';
import fs from 'node:fs/promises';
import Ignore from 'ignore';
import type { FileContent, FileDiscoverer } from '../types.js';

const readGitignore = async (root: string): Promise<string> => {
  try {
    return await fs.readFile(path.join(root, '.gitignore'), 'utf-8');
  } catch {
    return '';
  }
};

/**
 * Creates the default file discoverer. It uses globby to find all files,
 * respecting .gitignore patterns and custom include/exclude rules.
 * @returns A FileDiscoverer function.
 */
export const createDefaultDiscoverer = (): FileDiscoverer => {
  return async ({ root, include, ignore, noGitignore = false }) => {
    try {
      const stats = await fs.stat(root);
      if (!stats.isDirectory()) {
        throw new Error(`Root path is not a directory: ${root}`);
      }
    } catch (e) {
      // Type guard to check for Node.js file system error
      if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') {
        throw new Error(`Root directory does not exist: ${root}`);
      } else {
        throw e;
      }
    }
    const patterns = include && include.length > 0 ? [...include] : ['**/*'];
    
    const ignoreFilter = Ignore();
    if (!noGitignore) {
      const gitignoreContent = await readGitignore(root);
      ignoreFilter.add(gitignoreContent);
    }
    if (ignore) {
      ignoreFilter.add(ignore.join('\n'));
    }

    const relativePaths = await globby(patterns, {
      cwd: root,
      gitignore: false, // We handle gitignore manually with the `ignore` package
      ignore: [...(ignore || []), '**/node_modules/**', '**/.git/**', '.gitignore'],
      dot: true,
      absolute: false,
    });

    const filteredPaths = relativePaths.filter(p => !ignoreFilter.ignores(p));

    const fileContents = await Promise.all(
      filteredPaths.map(async (relativePath): Promise<FileContent | null> => {
        try {
          const absolutePath = path.join(root, relativePath);
          const buffer = await fs.readFile(absolutePath);
          // A simple heuristic to filter out binary files is checking for a null byte.
          if (buffer.includes(0)) return null;
          const content = buffer.toString('utf-8');
          return { path: relativePath, content };
        } catch {
          // Ignore files that can't be read (e.g., binary files, permission errors)
          return null;
        }
      })
    );

    return fileContents.filter((c): c is FileContent => c !== null);
  };
};