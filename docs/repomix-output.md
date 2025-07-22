# Directory Structure
```
test/
  e2e/
    cli.test.ts
  fixtures/
    complex-project.yaml
    minimal-project.yaml
    sample-project.yaml
  integration/
    multi-language.test.ts
    pipeline.test.ts
  unit/
    analyze.test.ts
    codenode-qualifiers.test.ts
    composer.test.ts
    discover.test.ts
    high-level.test.ts
    rank.test.ts
    render.test.ts
    scn-ts-integration.test.ts
  test-utilities.test.ts
  test.util.ts
```

# Files

## File: test/fixtures/complex-project.yaml
````yaml
name: "Complex Project"
description: "A complex project with multiple modules and dependencies"
files:
  - path: "src/index.ts"
    content: |
      export { Database } from './database/index.js';
      export { ApiServer } from './api/server.js';
      export { UserService } from './services/user.js';
      export * from './types/index.js';
  
  - path: "src/database/index.ts"
    content: |
      import { Config } from '../types/index.js';
      
      export interface DatabaseConnection {
        connect(): Promise<void>;
        disconnect(): Promise<void>;
      }
      
      export class Database implements DatabaseConnection {
        private config: Config;
        
        constructor(config: Config) {
          this.config = config;
        }
        
        async connect(): Promise<void> {
          // Implementation
        }
        
        async disconnect(): Promise<void> {
          // Implementation
        }
      }
  
  - path: "src/api/server.ts"
    content: |
      import { Database } from '../database/index.js';
      import { UserService } from '../services/user.js';
      import { ApiConfig } from '../types/index.js';
      
      export class ApiServer {
        private db: Database;
        private userService: UserService;
        private config: ApiConfig;
        
        constructor(config: ApiConfig, db: Database) {
          this.config = config;
          this.db = db;
          this.userService = new UserService(db);
        }
        
        async start(): Promise<void> {
          await this.db.connect();
        }
        
        async stop(): Promise<void> {
          await this.db.disconnect();
        }
      }
  
  - path: "src/services/user.ts"
    content: |
      import { Database } from '../database/index.js';
      import { User, CreateUserRequest } from '../types/index.js';
      
      export class UserService {
        private db: Database;
        
        constructor(db: Database) {
          this.db = db;
        }
        
        async createUser(request: CreateUserRequest): Promise<User> {
          // Implementation
          return {} as User;
        }
        
        async getUser(id: string): Promise<User | null> {
          // Implementation
          return null;
        }
      }
      
      export const validateUser = (user: User): boolean => {
        return user.id !== undefined && user.name !== undefined;
      };
  
  - path: "src/types/index.ts"
    content: |
      export interface Config {
        database: {
          host: string;
          port: number;
        };
      }
      
      export interface ApiConfig extends Config {
        api: {
          port: number;
          cors: boolean;
        };
      }
      
      export interface User {
        id: string;
        name: string;
        email: string;
        createdAt: Date;
      }
      
      export interface CreateUserRequest {
        name: string;
        email: string;
      }
      
      export type UserStatus = 'active' | 'inactive' | 'suspended';
  
  - path: "src/utils/validation.ts"
    content: |
      export const isEmail = (email: string): boolean => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      };
      
      export const isValidId = (id: string): boolean => {
        return id.length > 0 && /^[a-zA-Z0-9-_]+$/.test(id);
      };
  
  - path: "tests/user.test.ts"
    content: |
      import { UserService } from '../src/services/user.js';
      
      // Test file - should be ignored by default
      describe('UserService', () => {
        it('should create user', () => {
          // Test implementation
        });
      });
  
  - path: "package.json"
    content: |
      {
        "name": "complex-project",
        "version": "2.1.0",
        "type": "module",
        "scripts": {
          "build": "tsc",
          "test": "bun test",
          "start": "node dist/index.js"
        }
      }

gitignore:
  - "node_modules"
  - "dist"
  - "*.log"
  - ".env"
  - "tests/**"

expected_nodes: 20
expected_files: 6
expected_symbols: 14
````

## File: test/fixtures/minimal-project.yaml
````yaml
name: "Minimal Project"
description: "A minimal project for basic testing"
files:
  - path: "src/main.ts"
    content: |
      export function hello(): string {
        return 'Hello, World!';
      }
      
      export const greet = (name: string): string => {
        return `Hello, ${name}!`;
      };
  
  - path: "package.json"
    content: |
      {
        "name": "minimal-project",
        "version": "1.0.0",
        "type": "module"
      }

gitignore: []

expected_nodes: 3
expected_files: 1
expected_symbols: 2
````

## File: test/unit/scn-ts-integration.test.ts
````typescript
import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createTreeSitterAnalyzer } from '../../src/pipeline/analyze.js';
import type { FileContent, CodeNode } from '../../src/types.js';
import {
  createTempDir,
  cleanupTempDir
} from '../test.util.js';
⋮----
// Test that the type system supports the new types
⋮----
// Should analyze TSX files without errors
⋮----
// Should have file node with correct language
⋮----
// Should detect the function
⋮----
// Should detect HTML elements
⋮----
// Verify HTML elements have proper structure
⋮----
// Look for specific elements
⋮----
// Should have file node with correct language
⋮----
// Should detect CSS rules
⋮----
// Verify CSS rules have proper structure
⋮----
// Look for specific selectors
⋮----
// Test async detection if implemented
⋮----
// Test canThrow detection if implemented
⋮----
// Test visibility detection if implemented
⋮----
// This test verifies that the transaction successfully added tree-sitter-css
⋮----
// Version may be updated, just verify it exists and starts with ^0.
⋮----
// This test verifies that tree-sitter-vue is available
⋮----
// Should detect all traditional TypeScript symbols
⋮----
// Verify basic properties are preserved
````

## File: test/test-utilities.test.ts
````typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  createTempDir,
  cleanupTempDir,
  createTestFiles,
  createGitignore,
  readAllFiles,
  isValidMarkdown,
  containsValidMermaid,
  extractFilePathsFromMarkdown,
  loadFixture,
  createProjectFromFixture
} from './test.util.js';
⋮----
expect(paths).not.toContain('README.md'); // Not a .ts/.js file
⋮----
// Should normalize to forward slashes
````

## File: test/unit/codenode-qualifiers.test.ts
````typescript
import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createTreeSitterAnalyzer } from '../../src/pipeline/analyze.js';
import type { FileContent } from '../../src/types.js';
import {
  createTempDir,
  cleanupTempDir,
} from '../test.util.js';
⋮----
expect(addNode!.visibility).toBeUndefined(); // No explicit modifier
⋮----
// Verify all original fields are still present
⋮----
// Verify new fields are present but don't break existing functionality
⋮----
// New fields should be undefined for interfaces (as expected)
⋮----
// Verify mapping to SCN '+' (public), '...' (async), '#(type)' (return type)
⋮----
expect(handleRequestNode!.visibility).toBe('public'); // Maps to SCN '+'
expect(handleRequestNode!.isAsync).toBe(true); // Maps to SCN '...'
expect(handleRequestNode!.returnType).toBe('Promise<Response>'); // Maps to SCN '#(type)'
⋮----
// Verify mapping to SCN '-' (private)
⋮----
expect(validateNode!.visibility).toBe('private'); // Maps to SCN '-'
⋮----
// Verify static mapping
⋮----
expect(createNode!.isStatic).toBe(true); // Static indicator
````

## File: test/unit/high-level.test.ts
````typescript
import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { generateMap } from '../../src/high-level.js';
import type { RepoGraphOptions } from '../../src/types.js';
import {
  createTempDir,
  cleanupTempDir,
  createTestFiles,
  assertFileExists,
  readFile,
  isValidMarkdown
} from '../test.util.js';
import path from 'node:path';
⋮----
// If we get here without throwing, the test passes
⋮----
// If we get here without throwing, the test passes
⋮----
include: ['**/*.ts', '**/*.js'] // Only include code files
⋮----
// Should not throw, but may result in empty output
⋮----
customHeader: '', // Empty header should be handled
⋮----
// Should contain results from all pipeline stages
expect(content).toContain('Calculator'); // From analysis
expect(content).toContain('```mermaid'); // From rendering
expect(content).toContain('src/calculator.ts'); // From discovery
⋮----
// Both should contain the same files but potentially different rankings
⋮----
// Create 20 files with some dependencies
⋮----
// Add an index file that imports everything
⋮----
expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
````

## File: test/integration/pipeline.test.ts
````typescript
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
````

## File: test/e2e/cli.test.ts
````typescript
import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { spawn } from 'node:child_process';
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
  createProjectFromFixture
} from '../test.util.js';
import path from 'node:path';
⋮----
const runCLI = async (args: string[], cwd?: string): Promise<
⋮----
// Should not crash, but might produce empty output
⋮----
// Check markdown structure
⋮----
// Check Mermaid graph
⋮----
// Check symbol details
⋮----
// Create a project with many files
⋮----
// Add some imports
⋮----
expect(endTime - startTime).toBeLessThan(15000); // Should complete within 15 seconds
````

## File: test/fixtures/sample-project.yaml
````yaml
name: "Sample TypeScript Project"
description: "A sample project for testing RepoGraph functionality"
files:
  - path: "src/index.ts"
    content: |
      export { Calculator } from './calculator.js';
      export { Logger } from './utils/logger.js';
      export * from './types.js';
  
  - path: "src/calculator.ts"
    content: |
      import { Logger } from './utils/logger.js';
      import { Config } from './types.js';

      export class Calculator {
        private logger: Logger;
        private config: Config;
        
        constructor(config: Config) {
          this.logger = new Logger();
          this.config = config;
        }
        
        add(a: number, b: number): number {
          this.logger.log('Adding numbers');
          return a + b;
        }
        
        multiply = (a: number, b: number): number => {
          this.logger.log('Multiplying numbers');
          return a * b;
        };
        
        divide(a: number, b: number): number {
          if (b === 0) {
            this.logger.warn('Division by zero');
            throw new Error('Division by zero');
          }
          return a / b;
        }
      }
  
  - path: "src/utils/logger.ts"
    content: |
      export interface LogLevel {
        level: 'info' | 'warn' | 'error';
      }

      export type LogMessage = string;

      export class Logger {
        private prefix: string;
        
        constructor(prefix = 'LOG') {
          this.prefix = prefix;
        }
        
        log(message: LogMessage): void {
          console.log(`[${this.prefix}] ${message}`);
        }
        
        warn(message: LogMessage): void {
          console.warn(`[${this.prefix}] WARNING: ${message}`);
        }
        
        error(message: LogMessage): void {
          console.error(`[${this.prefix}] ERROR: ${message}`);
        }
      }

      export const createLogger = (prefix?: string): Logger => {
        return new Logger(prefix);
      };
  
  - path: "src/types.ts"
    content: |
      export interface Config {
        debug: boolean;
        version: string;
        logLevel: 'info' | 'warn' | 'error';
      }

      export type Status = 'active' | 'inactive' | 'pending';
      
      export interface User {
        id: number;
        name: string;
        status: Status;
      }
  
  - path: "src/math/advanced.ts"
    content: |
      import { Calculator } from '../calculator.js';

      export class AdvancedCalculator extends Calculator {
        power(base: number, exponent: number): number {
          return Math.pow(base, exponent);
        }
        
        sqrt(value: number): number {
          return Math.sqrt(value);
        }
      }
      
      export const factorial = (n: number): number => {
        if (n <= 1) return 1;
        return n * factorial(n - 1);
      };
  
  - path: "README.md"
    content: |
      # Sample Project
      
      This is a sample TypeScript project for testing RepoGraph.
      
      ## Features
      - Calculator functionality
      - Logging utilities
      - Type definitions
  
  - path: "package.json"
    content: |
      {
        "name": "sample-project",
        "version": "1.0.0",
        "type": "module",
        "main": "./dist/index.js",
        "scripts": {
          "build": "tsc",
          "test": "bun test"
        },
        "dependencies": {},
        "devDependencies": {
          "typescript": "^5.0.0"
        }
      }

gitignore:
  - "node_modules"
  - "dist"
  - "*.log"
  - ".env"

expected_nodes: 28
expected_files: 5
expected_symbols: 23
````

## File: test/unit/analyze.test.ts
````typescript
import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createTreeSitterAnalyzer } from '../../src/pipeline/analyze.js';
import type { FileContent } from '../../src/types.js';
import {
  createTempDir,
  cleanupTempDir,
  loadFixture,
  createProjectFromFixture
} from '../test.util.js';
⋮----
expect(graph.nodes.size).toBeGreaterThan(0); // Should have nodes
⋮----
// Check if import edges exist
⋮----
// Should still create file nodes
⋮----
// Should still create file nodes for both
⋮----
// Check import edges
⋮----
// Should identify the outer class
⋮----
// Should only have one Calculator node (first one wins)
⋮----
// Check for specific symbols from the fixture
⋮----
// Check for key classes and interfaces
⋮----
// Check for import relationships
````

## File: test/unit/discover.test.ts
````typescript
import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createDefaultDiscoverer } from '../../src/pipeline/discover.js';
import {
  createTempDir,
  cleanupTempDir,
  createTestFiles,
  createSymlink,
} from '../test.util.js';
import path from 'node:path';
⋮----
// This test might be skipped on Windows if symlinks can't be created
⋮----
// The discoverer should resolve the symlink and find the file within it.
⋮----
return; // Skip this test on systems without symlink permissions
⋮----
// Create a symlink from 'sub/link-to-parent' to '.' (tempDir)
⋮----
// The discoverer should complete without throwing a 'too many open files' error or timing out.
⋮----
return; // Skip this test on systems without symlink permissions
````

## File: test/unit/rank.test.ts
````typescript
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
⋮----
// Component 1
⋮----
// Component 2
⋮----
// In two identical components, ranks of corresponding nodes should be equal
⋮----
// Commit 1: Create original file
⋮----
// Commit 2: Rename and modify
⋮----
// Commit 3: Modify again
⋮----
// The rank should reflect all 3 commits, including history from before the rename.
// A rank of 1.0 indicates it has been part of every commit.
````

## File: test/test.util.ts
````typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createTreeSitterAnalyzer } from '../src/pipeline/analyze.js';
import yaml from 'js-yaml';
import type { FileContent, CodeNode, CodeGraph, CodeEdge, RepoGraphOptions } from '../src/types.js';
import { generateMap } from '../src/high-level.js';
import { execSync } from 'node:child_process';
⋮----
/**
 * Test utilities for RepoGraph testing
 */
⋮----
/**
 * Creates a temporary directory for testing
 */
export const createTempDir = async (): Promise<string> =>
⋮----
/**
 * Cleans up a temporary directory
 */
export const cleanupTempDir = async (dir: string): Promise<void> =>
⋮----
// Ignore cleanup errors
⋮----
/**
 * Creates a test file structure in a directory
 */
export const createTestFiles = async (
  baseDir: string,
  files: Record<string, string>
): Promise<void> =>
⋮----
/**
 * Creates a .gitignore file in the specified directory
 */
export const createGitignore = async (
  baseDir: string,
  patterns: string[]
): Promise<void> =>
⋮----
/**
 * Reads all files in a directory recursively
 */
export const readAllFiles = async (dir: string): Promise<FileContent[]> =>
⋮----
const readDir = async (currentDir: string, relativePath = ''): Promise<void> =>
⋮----
path: relativeEntryPath.replace(/\\/g, '/'), // Normalize path separators
⋮----
// Skip files that can't be read
⋮----
/**
 * Creates sample TypeScript files for testing
 */
export const createSampleTSFiles = (): Record<string, string> =>
⋮----
/**
 * Creates a minimal test project structure
 */
export const createMinimalProject = (): Record<string, string> =>
⋮----
/**
 * Asserts that a file exists
 */
export const assertFileExists = async (filePath: string): Promise<void> =>
⋮----
/**
 * Reads a file and returns its content
 */
export const readFile = async (filePath: string): Promise<string> =>
⋮----
/**
 * Checks if a directory exists
 */
export const directoryExists = async (dirPath: string): Promise<boolean> =>
⋮----
/**
 * Creates a symbolic link for testing
 */
export const createSymlink = async (target: string, linkPath: string): Promise<void> =>
⋮----
// Ensure the parent directory exists
⋮----
throw error; // Don't silently ignore - the test should know if symlinks aren't supported
⋮----
/**
 * Validates that a string contains valid Markdown
 */
export const isValidMarkdown = (content: string): boolean =>
⋮----
// Basic markdown validation: check for headers or the standard empty message.
⋮----
/**
 * Validates that a string contains valid Mermaid syntax
 */
export const containsValidMermaid = (content: string): boolean =>
⋮----
/**
 * Extracts file paths from markdown content
 */
export const extractFilePathsFromMarkdown = (content: string): string[] =>
⋮----
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
⋮----
/**
 * Loads a test fixture from a YAML file
 */
export const loadFixture = async (fixtureName: string): Promise<TestFixture> =>
⋮----
// Get the correct path relative to the project root
⋮----
/**
 * Creates a test project from a fixture
 */
export const createProjectFromFixture = async (
  baseDir: string,
  fixture: TestFixture
): Promise<void> =>
⋮----
// Create files
⋮----
// Create .gitignore if specified
⋮----
// --- Radically DRY Test Helpers ---
⋮----
/**
 * A powerful, centralized test runner that handles setup, execution, and cleanup.
 */
export const runRepoGraphForTests = async (
  files: Record<string, string>,
  options: Partial<RepoGraphOptions> = {}
): Promise<string> =>
⋮----
/**
 * Creates a mock CodeNode for testing.
 */
export const createTestNode = (id: string, partial: Partial<CodeNode> =
⋮----
/**
 * Creates a mock CodeGraph for testing.
 */
export const createTestGraph = (nodes: CodeNode[], edges: CodeEdge[] = []): CodeGraph => (
⋮----
/**
 * Initializes a git repository in the given directory.
 */
export const setupGitRepo = async (dir: string) =>
⋮----
// Silently fail if git is not available
⋮----
/**
 * Runs only the analysis stage for testing purposes.
 */
export const runAnalyzerForTests = async (files: FileContent[]): Promise<CodeGraph> =>
⋮----
/**
 * Makes a git commit in the given repository.
 */
export const makeGitCommit = async (dir: string, message: string, files?: string[]) =>
⋮----
// Silently fail if git is not available
````

## File: test/unit/render.test.ts
````typescript
import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createMarkdownRenderer } from '../../src/pipeline/render.js';
import { createTreeSitterAnalyzer } from '../../src/pipeline/analyze.js';
import { createPageRanker } from '../../src/pipeline/rank.js';
import type { CodeNode, CodeEdge, FileContent, RankedCodeGraph, RendererOptions } from '../../src/types.js';
import {
  createTempDir,
  cleanupTempDir,
  isValidMarkdown,
  containsValidMermaid,
  createTestNode,
} from '../test.util.js';
⋮----
// Create 15 files with different ranks
⋮----
ranks.set(nodeId, i / 15); // Higher numbers get higher ranks
⋮----
// Should contain the top 10 files (file15 to file6)
⋮----
// Should not contain the lower ranked files
⋮----
// Add symbols in non-sequential order
⋮----
// Check that symbols appear in line number order
⋮----
// Check order in the file breakdown section
⋮----
// Should not include empty code block
⋮----
// Add multiple edges between the same files (multi-graph)
⋮----
// Should only appear once in the Mermaid graph
````

## File: test/integration/multi-language.test.ts
````typescript
import { describe, it, expect } from 'bun:test';
import { runAnalyzerForTests } from '../test.util.js';
import type { FileContent } from '../../src/types.js';
⋮----
interface TestCase {
  language: string;
  files: FileContent[];
  expectedNodeIds: string[];
  expectedEdges?: Array<{ from: string; to: string; type: 'imports' | 'inherits' | 'implements' }>;
}
⋮----
// Verify all expected nodes exist
⋮----
// Verify all expected edges exist
⋮----
// Should not create symbol nodes for non-code files
````

## File: test/unit/composer.test.ts
````typescript
import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createMapGenerator } from '../../src/composer.js';
import { createDefaultDiscoverer } from '../../src/pipeline/discover.js';
import { createTreeSitterAnalyzer } from '../../src/pipeline/analyze.js';
import { createPageRanker } from '../../src/pipeline/rank.js';
import { createMarkdownRenderer } from '../../src/pipeline/render.js';
import type { FileDiscoverer, Analyzer, Ranker, Renderer, FileContent, RepoGraphMap } from '../../src/types.js';
import {
  createTempDir, // Keep for beforeEach/afterEach
  cleanupTempDir,
  createTestFiles,
  assertFileExists,
  isValidMarkdown,
} from '../test.util.js';
⋮----
createTempDir, // Keep for beforeEach/afterEach
⋮----
import path from 'node:path';
import fs from 'node:fs/promises';
⋮----
// Missing render
⋮----
// Missing rank
⋮----
// Missing analyze
⋮----
// Missing discover
⋮----
// Custom discoverer that tracks what it found
const customDiscoverer: FileDiscoverer = async (options) =>
⋮----
const customAnalyzer: Analyzer = async (files) =>
⋮----
const customRanker: Ranker = async (graph) =>
⋮----
const customRenderer: Renderer = (rankedGraph, options) =>
⋮----
const customDiscoverer: FileDiscoverer = async () => [
const customAnalyzer: Analyzer = async () => (
const customRanker: Ranker = async (g) => (
const customRenderer: Renderer = ()
⋮----
const errorDiscoverer: FileDiscoverer = async () =>
⋮----
const errorAnalyzer: Analyzer = async () =>
⋮----
const errorRanker: Ranker = async () =>
⋮----
const errorRenderer: Renderer = () =>
⋮----
// Try to write to an invalid path
⋮----
const trackingRenderer: Renderer = (_graph, options) =>
⋮----
const trackingDiscoverer: FileDiscoverer = async (options) =>
⋮----
const trackingAnalyzer: Analyzer = async (files) =>
⋮----
const trackingRanker: Ranker = async (graph) =>
⋮----
const trackingRenderer: Renderer = (rankedGraph, options) =>
````
