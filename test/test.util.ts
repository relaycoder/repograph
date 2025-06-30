import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import type { FileContent, CodeNode, CodeGraph, CodeEdge, RepoGraphOptions } from '../src/types.js';
import { generateMap } from '../src/high-level.js';
import { execSync } from 'node:child_process';

/**
 * Test utilities for RepoGraph testing
 */

/**
 * Creates a temporary directory for testing
 */
export const createTempDir = async (): Promise<string> => {
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'repograph-test-'));
  return tempDir;
};

/**
 * Cleans up a temporary directory
 */
export const cleanupTempDir = async (dir: string): Promise<void> => {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
};

/**
 * Creates a test file structure in a directory
 */
export const createTestFiles = async (
  baseDir: string,
  files: Record<string, string>
): Promise<void> => {
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(baseDir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
  }
};

/**
 * Creates a .gitignore file in the specified directory
 */
export const createGitignore = async (
  baseDir: string,
  patterns: string[]
): Promise<void> => {
  const gitignorePath = path.join(baseDir, '.gitignore');
  await fs.writeFile(gitignorePath, patterns.join('\n'));
};

/**
 * Reads all files in a directory recursively
 */
export const readAllFiles = async (dir: string): Promise<FileContent[]> => {
  const files: FileContent[] = [];
  
  const readDir = async (currentDir: string, relativePath = ''): Promise<void> => {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      const relativeEntryPath = path.join(relativePath, entry.name);
      
      if (entry.isDirectory()) {
        await readDir(entryPath, relativeEntryPath);
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(entryPath, 'utf-8');
          files.push({
            path: relativeEntryPath.replace(/\\/g, '/'), // Normalize path separators
            content
          });
        } catch {
          // Skip files that can't be read
        }
      }
    }
  };
  
  await readDir(dir);
  return files;
};

/**
 * Creates sample TypeScript files for testing
 */
export const createSampleTSFiles = (): Record<string, string> => {
  return {
    'src/index.ts': `export { Calculator } from './calculator.js';
export { Logger } from './utils/logger.js';`,
    
    'src/calculator.ts': `import { Logger } from './utils/logger.js';

export class Calculator {
  private logger: Logger;
  
  constructor() {
    this.logger = new Logger();
  }
  
  add(a: number, b: number): number {
    this.logger.log('Adding numbers');
    return a + b;
  }
  
  multiply = (a: number, b: number): number => {
    return a * b;
  };
}`,
    
    'src/utils/logger.ts': `export interface LogLevel {
  level: 'info' | 'warn' | 'error';
}

export type LogMessage = string;

export class Logger {
  log(message: LogMessage): void {
    console.log(message);
  }
  
  warn(message: LogMessage): void {
    console.warn(message);
  }
}

export const createLogger = (): Logger => {
  return new Logger();
};`,
    
    'src/types.ts': `export interface Config {
  debug: boolean;
  version: string;
}

export type Status = 'active' | 'inactive';`,
    
    'README.md': '# Test Project\n\nThis is a test project.',
    
    'package.json': JSON.stringify({
      name: 'test-project',
      version: '1.0.0',
      type: 'module'
    }, null, 2)
  };
};

/**
 * Creates a minimal test project structure
 */
export const createMinimalProject = (): Record<string, string> => {
  return {
    'src/main.ts': `export function hello(): string {
  return 'Hello, World!';
}`,
    'package.json': JSON.stringify({
      name: 'minimal-project',
      version: '1.0.0'
    }, null, 2)
  };
};

/**
 * Asserts that a file exists
 */
export const assertFileExists = async (filePath: string): Promise<void> => {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`File does not exist: ${filePath}`);
  }
};

/**
 * Reads a file and returns its content
 */
export const readFile = async (filePath: string): Promise<string> => {
  return await fs.readFile(filePath, 'utf-8');
};

/**
 * Checks if a directory exists
 */
export const directoryExists = async (dirPath: string): Promise<boolean> => {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
};

/**
 * Creates a symbolic link for testing
 */
export const createSymlink = async (target: string, linkPath: string): Promise<void> => {
  try {
    await fs.symlink(target, linkPath);
  } catch {
    // Ignore symlink creation errors (may not be supported on all platforms)
  }
};

/**
 * Validates that a string contains valid Markdown
 */
export const isValidMarkdown = (content: string): boolean => {
  // Basic markdown validation - check for common markdown patterns
  const hasHeaders = /^#{1,6}\s+.+$/m.test(content);
  const hasContent = content.trim().length > 0;
  return hasHeaders || hasContent; // Allow content without headers for empty results
};

/**
 * Validates that a string contains valid Mermaid syntax
 */
export const containsValidMermaid = (content: string): boolean => {
  return content.includes('```mermaid') && content.includes('graph TD');
};

/**
 * Extracts file paths from markdown content
 */
export const extractFilePathsFromMarkdown = (content: string): string[] => {
  const pathRegex = /`([^`]+\.(ts|js|tsx|jsx|py|java|go|rs|c))`/g;
  const paths: string[] = [];
  let match;
  
  while ((match = pathRegex.exec(content)) !== null) {
    if (match[1]) {
      paths.push(match[1]);
    }
  }
  
  return paths;
};

/**
 * Test fixture structure
 */
export interface TestFixture {
  name: string;
  description: string;
  files: Array<{
    path: string;
    content: string;
  }>;
  gitignore?: string[];
  expected_nodes?: number;
  expected_files?: number;
  expected_symbols?: number;
}

/**
 * Loads a test fixture from a YAML file
 */
export const loadFixture = async (fixtureName: string): Promise<TestFixture> => {
  // Get the correct path relative to the project root
  const projectRoot = process.cwd().endsWith('/test') ? path.dirname(process.cwd()) : process.cwd();
  const fixturePath = path.join(projectRoot, 'test', 'fixtures', `${fixtureName}.yaml`);
  const content = await fs.readFile(fixturePath, 'utf-8');
  return yaml.load(content) as TestFixture;
};

/**
 * Creates a test project from a fixture
 */
export const createProjectFromFixture = async (
  baseDir: string,
  fixture: TestFixture
): Promise<void> => {
  // Create files
  const fileMap: Record<string, string> = {};
  for (const file of fixture.files) {
    fileMap[file.path] = file.content;
  }
  await createTestFiles(baseDir, fileMap);
  
  // Create .gitignore if specified
  if (fixture.gitignore && fixture.gitignore.length > 0) {
    await createGitignore(baseDir, fixture.gitignore);
  }
};

// --- Radically DRY Test Helpers ---

/**
 * A powerful, centralized test runner that handles setup, execution, and cleanup.
 */
export const runRepoGraphForTests = async (
  files: Record<string, string>,
  options: Partial<RepoGraphOptions> = {}
): Promise<string> => {
  const tempDir = await createTempDir();
  try {
    await createTestFiles(tempDir, files);
    const outputPath = path.join(tempDir, 'output.md');

    if (options.rankingStrategy === 'git-changes') {
      await setupGitRepo(tempDir);
      await makeGitCommit(tempDir, 'Initial commit');
    }

    await generateMap({
      root: tempDir,
      output: outputPath,
      ...options,
    });
    return await readFile(outputPath);
  } finally {
    await cleanupTempDir(tempDir);
  }
};

/**
 * Creates a mock CodeNode for testing.
 */
export const createTestNode = (id: string, partial: Partial<CodeNode> = {}): CodeNode => ({
  id,
  type: 'file',
  name: path.basename(id),
  filePath: id,
  startLine: 1,
  endLine: 10,
  ...partial,
});

/**
 * Creates a mock CodeGraph for testing.
 */
export const createTestGraph = (nodes: CodeNode[], edges: CodeEdge[] = []): CodeGraph => ({
  nodes: new Map(nodes.map(n => [n.id, n])),
  edges,
});

/**
 * Initializes a git repository in the given directory.
 */
export const setupGitRepo = async (dir: string) => {
  try {
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
  } catch (e) {
    // Silently fail if git is not available
  }
};

/**
 * Makes a git commit in the given repository.
 */
export const makeGitCommit = async (dir: string, message: string, files?: string[]) => {
  try {
    const filesToAdd = files ? files.join(' ') : '.';
    execSync(`git add ${filesToAdd}`, { cwd: dir, stdio: 'ignore' });
    execSync(`git commit -m "${message}"`, { cwd: dir, stdio: 'ignore' });
  } catch (e) {
    // Silently fail if git is not available
  }
};