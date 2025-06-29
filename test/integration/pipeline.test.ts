import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createMapGenerator } from '../../src/composer.js';
import { createDefaultDiscoverer } from '../../src/pipeline/discover.js';
import { createTreeSitterAnalyzer } from '../../src/pipeline/analyze.js';
import { createPageRanker, createGitRanker } from '../../src/pipeline/rank.js';
import { createMarkdownRenderer } from '../../src/pipeline/render.js';
import type { RendererOptions } from '../../src/types.js';
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

describe('Pipeline Integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Full Pipeline Execution', () => {
    it('should execute complete pipeline with default components', async () => {
      const files = {
        'src/index.ts': `import { Calculator } from './calculator.js';
export { Calculator };`,
        'src/calculator.ts': `export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}`
      };
      await createTestFiles(tempDir, files);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'output.md');
      await generator({
        root: tempDir,
        output: outputPath,
        include: ['**/*.ts']
      });

      await assertFileExists(outputPath);
      const content = await readFile(outputPath);
      
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('Calculator');
      expect(containsValidMermaid(content)).toBe(true);
    });

    it('should handle empty project gracefully', async () => {
      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'empty.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      await assertFileExists(outputPath);
      const content = await readFile(outputPath);
      
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('This repository contains 0 nodes (0 files)');
    });

    it('should respect include patterns in pipeline', async () => {
      const files = {
        'src/index.ts': 'export const ts = true;',
        'src/index.js': 'export const js = true;',
        'README.md': '# Project'
      };
      await createTestFiles(tempDir, files);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'ts-only.md');
      await generator({
        root: tempDir,
        output: outputPath,
        include: ['**/*.ts']
      });

      const content = await readFile(outputPath);
      expect(content).toContain('src/index.ts');
      expect(content).not.toContain('src/index.js');
      expect(content).not.toContain('README.md');
    });

    it('should respect ignore patterns in pipeline', async () => {
      const files = {
        'src/index.ts': 'export const main = true;',
        'src/test.spec.ts': 'test code',
        'src/utils.ts': 'export const util = true;'
      };
      await createTestFiles(tempDir, files);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'no-tests.md');
      await generator({
        root: tempDir,
        output: outputPath,
        ignore: ['**/*.spec.ts']
      });

      const content = await readFile(outputPath);
      expect(content).toContain('src/index.ts');
      expect(content).toContain('src/utils.ts');
      expect(content).not.toContain('src/test.spec.ts');
    });

    it('should respect gitignore in pipeline', async () => {
      const files = {
        'src/index.ts': 'export const main = true;',
        'dist/index.js': 'compiled code',
        'node_modules/package/index.js': 'dependency'
      };
      await createTestFiles(tempDir, files);
      await createGitignore(tempDir, ['dist/', 'node_modules/']);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'with-gitignore.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      expect(content).toContain('src/index.ts');
      expect(content).not.toContain('dist/index.js');
      expect(content).not.toContain('node_modules/package/index.js');
    });

    it('should create output directory if it does not exist', async () => {
      const files = {
        'src/index.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'nested', 'deep', 'output.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      await assertFileExists(outputPath);
    });

    it('should pass renderer options through pipeline', async () => {
      const files = {
        'src/index.ts': `import { util1, util2, util3 } from './utils.js';
export function main() { util1(); util2(); util3(); }`,
        'src/utils.ts': `export function util1() {}
export function util2() {}
export function util3() {}`
      };
      await createTestFiles(tempDir, files);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const rendererOptions: RendererOptions = {
        includeHeader: false,
        includeOverview: false,
        includeMermaidGraph: false,
        includeFileList: false,
        includeSymbolDetails: true,
        fileSectionSeparator: '***',
        symbolDetailOptions: {
          includeRelations: false,
          includeLineNumber: false,
          includeCodeSnippet: false,
        },
      };

      const outputPath = path.join(tempDir, 'custom.md');
      await generator({
        root: tempDir,
        output: outputPath,
        rendererOptions
      });

      const content = await readFile(outputPath);
      expect(content).not.toContain('# RepoGraph');
      expect(content).not.toContain('## 🚀 Project Overview');
      expect(content).not.toContain('```mermaid');
      expect(content).not.toContain('### Top');
      expect(content).toContain('## 📂 File & Symbol Breakdown');
      expect(content).toContain('\n***\n\n');
      expect(content).not.toContain('(calls `util1`');
      expect(content).not.toContain('_L2_');
      expect(content).not.toContain('```typescript');
    });
  });

  describe('Component Composition', () => {
    it('should work with PageRank ranking strategy', async () => {
      const files = {
        'src/hub.ts': 'export class Hub {}',
        'src/a.ts': `import { Hub } from './hub.js';`,
        'src/b.ts': `import { Hub } from './hub.js';`,
        'src/c.ts': `import { Hub } from './hub.js';`
      };
      await createTestFiles(tempDir, files);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'pagerank.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      expect(content).toContain('Hub');
      
      // Hub should appear early in the ranking due to being imported by multiple files
      const hubIndex = content.indexOf('src/hub.ts');
      expect(hubIndex).toBeGreaterThan(-1);
    });

    it('should work with Git ranking strategy', async () => {
      const files = {
        'src/index.ts': 'export const main = true;',
        'src/utils.ts': 'export const util = true;'
      };
      await createTestFiles(tempDir, files);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createGitRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'git-rank.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('src/index.ts');
      expect(content).toContain('src/utils.ts');
    });

    it('should allow custom pipeline component combinations', async () => {
      const files = {
        'src/index.ts': `export class Example {
  method(): string {
    return 'test';
  }
}`
      };
      await createTestFiles(tempDir, files);

      // Create a custom renderer that adds extra information
      const customRenderer = () => {
        const baseRenderer = createMarkdownRenderer();
        return (rankedGraph: any, options?: any) => {
          const baseMarkdown = baseRenderer(rankedGraph, options);
          return `${baseMarkdown}\n\n<!-- Generated with custom renderer -->`;
        };
      };

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: customRenderer()
      });

      const outputPath = path.join(tempDir, 'custom-renderer.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      expect(content).toContain('<!-- Generated with custom renderer -->');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid root directory', async () => {
      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const invalidRoot = path.join(tempDir, 'non-existent');
      const outputPath = path.join(tempDir, 'error.md');

      await expect(generator({
        root: invalidRoot,
        output: outputPath
      })).rejects.toThrow();
    });

    it('should handle files that cannot be parsed', async () => {
      const files = {
        'src/valid.ts': 'export const valid = true;',
        'src/invalid.ts': 'this is not valid typescript syntax {{{',
        'binary.bin': Buffer.from([0x00, 0x01, 0x02, 0x03]).toString()
      };
      await createTestFiles(tempDir, files);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'mixed.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      expect(content).toContain('src/valid.ts');
      // Should still process the invalid file as a file node
      expect(content).toContain('src/invalid.ts');
    });

    it('should handle circular dependencies gracefully', async () => {
      const files = {
        'src/a.ts': `import { B } from './b.js';
export class A {
  b: B;
}`,
        'src/b.ts': `import { A } from './a.js';
export class B {
  a: A;
}`
      };
      await createTestFiles(tempDir, files);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'circular.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      expect(content).toContain('src/a.ts');
      expect(content).toContain('src/b.ts');
      expect(containsValidMermaid(content)).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should handle moderately large projects efficiently', async () => {
      // Create a project with many files
      const files: Record<string, string> = {};
      
      for (let i = 0; i < 50; i++) {
        files[`src/file${i}.ts`] = `export class Class${i} {
  method${i}(): number {
    return ${i};
  }
}`;
      }

      // Add some imports to create dependencies
      for (let i = 1; i < 50; i++) {
        files[`src/file${i}.ts`] = `import { Class${i-1} } from './file${i-1}.js';
${files[`src/file${i}.ts`]}`;
      }

      await createTestFiles(tempDir, files);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'large.md');
      const startTime = Date.now();
      
      await generator({
        root: tempDir,
        output: outputPath
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds

      const content = await readFile(outputPath);
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('Class0');
      expect(content).toContain('Class49');
    });
  });

  describe('Integration with Fixtures', () => {
    it('should process sample-project fixture end-to-end', async () => {
      const fixture = await loadFixture('sample-project');
      await createProjectFromFixture(tempDir, fixture);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'sample-output.md');
      await generator({
        root: tempDir,
        output: outputPath,
        include: ['**/*.ts']
      });

      const content = await readFile(outputPath);
      
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('Calculator');
      expect(content).toContain('Logger');
      expect(content).toContain('Config');
      expect(content).toContain('AdvancedCalculator');
      expect(containsValidMermaid(content)).toBe(true);
      
      // Should show import relationships
      expect(content).toContain('src/calculator.ts');
      expect(content).toContain('src/utils/logger.ts');
      expect(content).toContain('src/types.ts');
    });

    it('should process complex-project fixture end-to-end', async () => {
      const fixture = await loadFixture('complex-project');
      await createProjectFromFixture(tempDir, fixture);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'complex-output.md');
      await generator({
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
      
      // Should exclude test files due to gitignore
      expect(content).not.toContain('tests/user.test.ts');
    });

    it('should handle minimal-project fixture', async () => {
      const fixture = await loadFixture('minimal-project');
      await createProjectFromFixture(tempDir, fixture);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'minimal-output.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('src/main.ts');
      expect(content).toContain('hello');
      expect(content).toContain('greet');
    });

    it('should work with all renderer options on fixtures', async () => {
      const fixture = await loadFixture('sample-project');
      await createProjectFromFixture(tempDir, fixture);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createGitRanker({ maxCommits: 100 }),
        render: createMarkdownRenderer()
      });

      const rendererOptions: RendererOptions = {
        customHeader: `# ${fixture.name}\n\n${fixture.description}`,
        includeMermaidGraph: true,
        includeSymbolDetails: true
      };

      const outputPath = path.join(tempDir, 'full-options.md');
      await generator({
        root: tempDir,
        output: outputPath,
        include: ['**/*.ts'],
        rendererOptions
      });

      const content = await readFile(outputPath);
      
      expect(content).toStartWith(`# ${fixture.name}`);
      expect(content).toContain(fixture.description);
      expect(containsValidMermaid(content)).toBe(true);
      expect(content).toContain('## 📂 File & Symbol Breakdown');
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle TypeScript project with various symbol types', async () => {
      const files = {
        'src/types.ts': `export interface User {
  id: string;
  name: string;
}

export type Status = 'active' | 'inactive';

export enum Role {
  ADMIN = 'admin',
  USER = 'user'
}`,
        'src/service.ts': `import { User, Status, Role } from './types.js';

export class UserService {
  private users: User[] = [];
  
  createUser(name: string): User {
    return {
      id: Math.random().toString(),
      name
    };
  }
  
  updateStatus = (userId: string, status: Status): void => {
    // Implementation
  };
}

export const validateRole = (role: string): role is Role => {
  return Object.values(Role).includes(role as Role);
};`,
        'src/index.ts': `export { UserService } from './service.js';
export type { User, Status } from './types.js';
export { Role } from './types.js';`
      };

      await createTestFiles(tempDir, files);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'typescript-project.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      
      expect(content).toContain('UserService');
      expect(content).toContain('User');
      expect(content).toContain('Status');
      expect(content).toContain('validateRole');
      expect(containsValidMermaid(content)).toBe(true);
    });

    it('should handle project with nested directory structure', async () => {
      const files = {
        'src/index.ts': `export * from './api/index.js';
export * from './utils/index.js';`,
        'src/api/index.ts': `export { ApiClient } from './client.js';
export { ApiServer } from './server.js';`,
        'src/api/client.ts': `export class ApiClient {
  get(url: string): Promise<any> {
    return fetch(url).then(r => r.json());
  }
}`,
        'src/api/server.ts': `export class ApiServer {
  listen(port: number): void {
    console.log(\`Server listening on port \${port}\`);
  }
}`,
        'src/utils/index.ts': `export { Logger } from './logger.js';
export { Cache } from './cache.js';`,
        'src/utils/logger.ts': `export class Logger {
  log(message: string): void {
    console.log(message);
  }
}`,
        'src/utils/cache.ts': `export class Cache<T> {
  private data = new Map<string, T>();
  
  set(key: string, value: T): void {
    this.data.set(key, value);
  }
  
  get(key: string): T | undefined {
    return this.data.get(key);
  }
}`
      };

      await createTestFiles(tempDir, files);

      const generator = createMapGenerator({
        discover: createDefaultDiscoverer(),
        analyze: createTreeSitterAnalyzer(),
        rank: createPageRanker(),
        render: createMarkdownRenderer()
      });

      const outputPath = path.join(tempDir, 'nested-project.md');
      await generator({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      
      expect(content).toContain('src/api/client.ts');
      expect(content).toContain('src/api/server.ts');
      expect(content).toContain('src/utils/logger.ts');
      expect(content).toContain('src/utils/cache.ts');
      expect(content).toContain('ApiClient');
      expect(content).toContain('ApiServer');
      expect(content).toContain('Logger');
      expect(content).toContain('Cache');
    });
  });
});