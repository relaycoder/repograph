import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { generateMap } from '../../src/high-level.js';
import type { RepoGraphOptions } from '../../src/types.js';
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

describe('High-Level API Integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('generateMap()', () => {
    it('should generate map with default options', async () => {
      const files = {
        'src/index.ts': `export class Example {
  method(): string {
    return 'hello';
  }
}`
      };
      await createTestFiles(tempDir, files);

      await generateMap({
        root: tempDir,
        output: path.join(tempDir, 'repograph.md')
      });

      const outputPath = path.join(tempDir, 'repograph.md');
      await assertFileExists(outputPath);
      
      const content = await readFile(outputPath);
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('Example');
    });

    it('should use current working directory as default root', async () => {
      const originalCwd = process.cwd();
      
      try {
        // Change to temp directory
        process.chdir(tempDir);
        
        const files = {
          'src/test.ts': 'export const test = true;'
        };
        await createTestFiles(tempDir, files);

        await generateMap({
          output: 'test-output.md'
        });

        await assertFileExists(path.join(tempDir, 'test-output.md'));
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should use default output path when not specified', async () => {
      const originalCwd = process.cwd();
      
      try {
        process.chdir(tempDir);
        
        const files = {
          'src/test.ts': 'export const test = true;'
        };
        await createTestFiles(tempDir, files);

        await generateMap();

        await assertFileExists(path.join(tempDir, 'repograph.md'));
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should respect include patterns', async () => {
      const files = {
        'src/index.ts': 'export const ts = true;',
        'src/index.js': 'export const js = true;',
        'README.md': '# Project'
      };
      await createTestFiles(tempDir, files);

      const outputPath = path.join(tempDir, 'ts-only.md');
      await generateMap({
        root: tempDir,
        output: outputPath,
        include: ['**/*.ts']
      });

      const content = await readFile(outputPath);
      expect(content).toContain('src/index.ts');
      expect(content).not.toContain('src/index.js');
      expect(content).not.toContain('README.md');
    });

    it('should respect ignore patterns', async () => {
      const files = {
        'src/index.ts': 'export const main = true;',
        'src/test.spec.ts': 'test code',
        'src/utils.ts': 'export const util = true;'
      };
      await createTestFiles(tempDir, files);

      const outputPath = path.join(tempDir, 'no-tests.md');
      await generateMap({
        root: tempDir,
        output: outputPath,
        ignore: ['**/*.spec.ts']
      });

      const content = await readFile(outputPath);
      expect(content).toContain('src/index.ts');
      expect(content).toContain('src/utils.ts');
      expect(content).not.toContain('src/test.spec.ts');
    });

    it('should respect noGitignore option', async () => {
      const files = {
        'src/index.ts': 'export const main = true;',
        'dist/index.js': 'compiled code'
      };
      await createTestFiles(tempDir, files);
      await createGitignore(tempDir, ['dist/']);

      const outputPath = path.join(tempDir, 'with-dist.md');
      await generateMap({
        root: tempDir,
        output: outputPath,
        noGitignore: true
      });

      const content = await readFile(outputPath);
      expect(content).toContain('src/index.ts');
      expect(content).toContain('dist/index.js');
    });

    it('should use PageRank strategy by default', async () => {
      const files = {
        'src/hub.ts': 'export class Hub {}',
        'src/a.ts': `import { Hub } from './hub.js';`,
        'src/b.ts': `import { Hub } from './hub.js';`
      };
      await createTestFiles(tempDir, files);

      const outputPath = path.join(tempDir, 'pagerank.md');
      await generateMap({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      expect(content).toContain('Hub');
      // Hub should be ranked highly due to imports
    });

    it('should use Git ranking strategy when specified', async () => {
      const files = {
        'src/index.ts': 'export const main = true;',
        'src/utils.ts': 'export const util = true;'
      };
      await createTestFiles(tempDir, files);

      const outputPath = path.join(tempDir, 'git-rank.md');
      await generateMap({
        root: tempDir,
        output: outputPath,
        rankingStrategy: 'git-changes'
      });

      const content = await readFile(outputPath);
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('src/index.ts');
    });

    it('should pass renderer options correctly', async () => {
      const files = {
        'src/index.ts': `import { util1, util2, util3 } from './utils.js';
export function main() { util1(); util2(); util3(); }`,
        'src/utils.ts': `export function util1() {}
export function util2() {}
export function util3() {}`
      };
      await createTestFiles(tempDir, files);

      const outputPath = path.join(tempDir, 'custom.md');
      await generateMap({
        root: tempDir,
        output: outputPath,
        rendererOptions: {
          customHeader: '# My Custom Project',
          includeOverview: false,
          includeMermaidGraph: false,
          includeFileList: true,
          topFileCount: 1,
          includeSymbolDetails: true,
          fileSectionSeparator: '***',
          symbolDetailOptions: {
            includeRelations: true,
            includeLineNumber: false,
            includeCodeSnippet: false,
            maxRelationsToShow: 1,
          },
        }
      });

      const content = await readFile(outputPath);
      expect(content).toStartWith('# My Custom Project');
      expect(content).not.toContain('## 🚀 Project Overview');
      expect(content).not.toContain('```mermaid');
      expect(content).toContain('### Top 1 Most Important Files');
      expect(content).toContain('## 📂 File & Symbol Breakdown');
      expect(content).toContain('\n***\n\n');
      expect(content).toContain('(calls `util1`...)');
      expect(content).not.toContain('`util2`');
      expect(content).not.toContain('_L2_');
      expect(content).not.toContain('```typescript');
    });

    it('should handle all boolean false renderer options', async () => {
       const files = { 'src/index.ts': 'export function main() {}' };
       await createTestFiles(tempDir, files);

       const outputPath = path.join(tempDir, 'custom-bools.md');
       await generateMap({
         root: tempDir,
         output: outputPath,
         rendererOptions: {
           includeHeader: false,
           includeOverview: false,
           includeMermaidGraph: false,
           includeFileList: false,
           includeSymbolDetails: false,
         }
       });

       const content = await readFile(outputPath);
       expect(content.trim()).toBe('');
    });

    it('should handle empty projects gracefully', async () => {
      const outputPath = path.join(tempDir, 'empty.md');
      await generateMap({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('This repository contains 0 nodes (0 files)');
    });

    it('should resolve relative root paths', async () => {
      const files = {
        'project/src/index.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const projectDir = path.join(tempDir, 'project');
      const outputPath = path.join(tempDir, 'relative.md');
      
      await generateMap({
        root: path.relative(process.cwd(), projectDir),
        output: outputPath
      });

      const content = await readFile(outputPath);
      expect(content).toContain('src/index.ts');
    });

    it('should handle complex TypeScript projects', async () => {
      const files = {
        'src/index.ts': `import { Database } from './database.js';
import { ApiServer } from './api.js';

export class Application {
  private db: Database;
  private api: ApiServer;
  
  constructor() {
    this.db = new Database();
    this.api = new ApiServer(this.db);
  }
  
  async start(): Promise<void> {
    await this.db.connect();
    this.api.listen(3000);
  }
}`,
        'src/database.ts': `export class Database {
  async connect(): Promise<void> {
    console.log('Connected to database');
  }
  
  async query(sql: string): Promise<any[]> {
    return [];
  }
}`,
        'src/api.ts': `import { Database } from './database.js';

export class ApiServer {
  constructor(private db: Database) {}
  
  listen(port: number): void {
    console.log(\`API server listening on port \${port}\`);
  }
  
  async handleRequest(path: string): Promise<any> {
    return this.db.query(\`SELECT * FROM \${path}\`);
  }
}`
      };
      await createTestFiles(tempDir, files);

      const outputPath = path.join(tempDir, 'complex.md');
      await generateMap({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      expect(content).toContain('Application');
      expect(content).toContain('Database');
      expect(content).toContain('ApiServer');
      expect(containsValidMermaid(content)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent root directory', async () => {
      const nonExistentPath = path.join(tempDir, 'non-existent');
      const outputPath = path.join(tempDir, 'error.md');

      await expect(generateMap({
        root: nonExistentPath,
        output: outputPath
      })).rejects.toThrow();
    });

    it('should handle invalid include patterns gracefully', async () => {
      const files = {
        'src/index.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const outputPath = path.join(tempDir, 'invalid-pattern.md');
      
      // This should not throw, just result in no files
      await generateMap({
        root: tempDir,
        output: outputPath,
        include: ['[invalid-pattern']
      });

      const content = await readFile(outputPath);
      expect(content).toContain('This repository contains 0 nodes (0 files)');
    });

    it('should handle write permission errors gracefully', async () => {
      const files = {
        'src/index.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      // Try to write to a directory that doesn't exist and can't be created
      const invalidOutputPath = '/root/cannot-write-here.md';

      await expect(generateMap({
        root: tempDir,
        output: invalidOutputPath
      })).rejects.toThrow();
    });
  });

  describe('Integration with Fixtures', () => {
    it('should process sample-project fixture with high-level API', async () => {
      const fixture = await loadFixture('sample-project');
      await createProjectFromFixture(tempDir, fixture);

      const outputPath = path.join(tempDir, 'sample-output.md');
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
    });

    it('should process complex-project fixture with high-level API', async () => {
      const fixture = await loadFixture('complex-project');
      await createProjectFromFixture(tempDir, fixture);

      const outputPath = path.join(tempDir, 'complex-output.md');
      await generateMap({
        root: tempDir,
        output: outputPath,
        include: ['**/*.ts'],
        rankingStrategy: 'pagerank'
      });

      const content = await readFile(outputPath);
      
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('Database');
      expect(content).toContain('ApiServer');
      expect(content).toContain('UserService');
      expect(containsValidMermaid(content)).toBe(true);
    });

    it('should handle minimal-project fixture', async () => {
      const fixture = await loadFixture('minimal-project');
      await createProjectFromFixture(tempDir, fixture);

      const outputPath = path.join(tempDir, 'minimal-output.md');
      await generateMap({
        root: tempDir,
        output: outputPath
      });

      const content = await readFile(outputPath);
      
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('src/main.ts');
      expect(content).toContain('hello');
      expect(content).toContain('greet');
    });

    it('should work with all ranking strategies on fixtures', async () => {
      const fixture = await loadFixture('sample-project');
      await createProjectFromFixture(tempDir, fixture);

      // Test PageRank strategy
      const pageRankOutput = path.join(tempDir, 'pagerank.md');
      await generateMap({
        root: tempDir,
        output: pageRankOutput,
        include: ['**/*.ts'],
        rankingStrategy: 'pagerank'
      });

      // Test Git strategy
      const gitOutput = path.join(tempDir, 'git.md');
      await generateMap({
        root: tempDir,
        output: gitOutput,
        include: ['**/*.ts'],
        rankingStrategy: 'git-changes'
      });

      const pageRankContent = await readFile(pageRankOutput);
      const gitContent = await readFile(gitOutput);

      expect(isValidMarkdown(pageRankContent)).toBe(true);
      expect(isValidMarkdown(gitContent)).toBe(true);
      
      // Both should contain the same symbols but potentially different rankings
      expect(pageRankContent).toContain('Calculator');
      expect(gitContent).toContain('Calculator');
    });

    it('should work with all renderer options on fixtures', async () => {
      const fixture = await loadFixture('complex-project');
      await createProjectFromFixture(tempDir, fixture);

      const outputPath = path.join(tempDir, 'full-options.md');
      
      const options: RepoGraphOptions = {
        root: tempDir,
        output: outputPath,
        include: ['**/*.ts'],
        ignore: ['**/*.test.ts'],
        rankingStrategy: 'pagerank',
        rendererOptions: {
          customHeader: `# ${fixture.name}\n\n${fixture.description}`,
          includeMermaidGraph: true,
          includeSymbolDetails: true
        }
      };

      await generateMap(options);

      const content = await readFile(outputPath);
      
      expect(content).toStartWith(`# ${fixture.name}`);
      expect(content).toContain(fixture.description);
      expect(containsValidMermaid(content)).toBe(true);
      expect(content).toContain('## 📂 File & Symbol Breakdown');
      expect(content).toContain('Database');
      expect(content).toContain('ApiServer');
    });
  });

  describe('Real-world Usage Patterns', () => {
    it('should work for analyzing a library project', async () => {
      const files = {
        'src/index.ts': `export { Calculator } from './calculator.js';
export { Logger } from './logger.js';
export type { CalculatorOptions } from './types.js';`,
        'src/calculator.ts': `import type { CalculatorOptions } from './types.js';
import { Logger } from './logger.js';

export class Calculator {
  private logger: Logger;
  private options: CalculatorOptions;
  
  constructor(options: CalculatorOptions = {}) {
    this.options = { precision: 2, ...options };
    this.logger = new Logger();
  }
  
  add(a: number, b: number): number {
    this.logger.log(\`Adding \${a} + \${b}\`);
    return Number((a + b).toFixed(this.options.precision));
  }
  
  multiply(a: number, b: number): number {
    this.logger.log(\`Multiplying \${a} * \${b}\`);
    return Number((a * b).toFixed(this.options.precision));
  }
}`,
        'src/logger.ts': `export class Logger {
  log(message: string): void {
    console.log(\`[Calculator] \${message}\`);
  }
}`,
        'src/types.ts': `export interface CalculatorOptions {
  precision?: number;
}`,
        'package.json': JSON.stringify({
          name: 'my-calculator',
          version: '1.0.0',
          type: 'module',
          main: './dist/index.js',
          types: './dist/index.d.ts'
        }, null, 2),
        'README.md': '# My Calculator\n\nA simple calculator library.'
      };
      await createTestFiles(tempDir, files);

      const outputPath = path.join(tempDir, 'library-docs.md');
      await generateMap({
        root: tempDir,
        output: outputPath,
        include: ['src/**/*.ts'],
        rendererOptions: {
          customHeader: '# My Calculator Library\n\nGenerated API documentation.',
          includeMermaidGraph: true,
          includeSymbolDetails: true
        }
      });

      const content = await readFile(outputPath);
      
      expect(content).toStartWith('# My Calculator Library');
      expect(content).toContain('Calculator');
      expect(content).toContain('Logger');
      expect(content).toContain('CalculatorOptions');
      expect(content).toContain('add');
      expect(content).toContain('multiply');
      expect(containsValidMermaid(content)).toBe(true);
    });

    it('should work for analyzing an application project', async () => {
      const files = {
        'src/main.ts': `import { App } from './app.js';

const app = new App();
app.start().catch(console.error);`,
        'src/app.ts': `import { Database } from './database/index.js';
import { ApiServer } from './api/server.js';
import { Config } from './config.js';

export class App {
  private db: Database;
  private api: ApiServer;
  private config: Config;
  
  constructor() {
    this.config = new Config();
    this.db = new Database(this.config.database);
    this.api = new ApiServer(this.db, this.config.api);
  }
  
  async start(): Promise<void> {
    await this.db.connect();
    this.api.listen();
    console.log('Application started');
  }
}`,
        'src/config.ts': `export class Config {
  database = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432')
  };
  
  api = {
    port: parseInt(process.env.API_PORT || '3000')
  };
}`,
        'src/database/index.ts': `export class Database {
  constructor(private config: any) {}
  
  async connect(): Promise<void> {
    console.log('Connected to database');
  }
}`,
        'src/api/server.ts': `export class ApiServer {
  constructor(private db: any, private config: any) {}
  
  listen(): void {
    console.log(\`API listening on port \${this.config.port}\`);
  }
}`
      };
      await createTestFiles(tempDir, files);

      const outputPath = path.join(tempDir, 'app-architecture.md');
      await generateMap({
        root: tempDir,
        output: outputPath,
        include: ['src/**/*.ts'],
        rankingStrategy: 'pagerank',
        rendererOptions: {
          customHeader: '# Application Architecture\n\nOverview of the application structure.',
          includeMermaidGraph: true,
          includeSymbolDetails: true
        }
      });

      const content = await readFile(outputPath);
      
      expect(content).toStartWith('# Application Architecture');
      expect(content).toContain('App');
      expect(content).toContain('Database');
      expect(content).toContain('ApiServer');
      expect(content).toContain('Config');
      expect(containsValidMermaid(content)).toBe(true);
    });

    it('should handle monorepo-style project structure', async () => {
      const files = {
        'packages/core/src/index.ts': `export { Engine } from './engine.js';`,
        'packages/core/src/engine.ts': `export class Engine {
  start(): void {
    console.log('Engine started');
  }
}`,
        'packages/ui/src/index.ts': `export { Component } from './component.js';`,
        'packages/ui/src/component.ts': `import { Engine } from '../../core/src/engine.js';

export class Component {
  private engine: Engine;
  
  constructor() {
    this.engine = new Engine();
  }
  
  render(): void {
    this.engine.start();
  }
}`,
        'apps/web/src/main.ts': `import { Component } from '../../../packages/ui/src/component.js';

const component = new Component();
component.render();`
      };
      await createTestFiles(tempDir, files);

      const outputPath = path.join(tempDir, 'monorepo.md');
      await generateMap({
        root: tempDir,
        output: outputPath,
        include: ['**/*.ts'],
        rendererOptions: {
          customHeader: '# Monorepo Structure',
          includeMermaidGraph: true,
          includeSymbolDetails: true
        }
      });

      const content = await readFile(outputPath);
      
      expect(content).toContain('Engine');
      expect(content).toContain('Component');
      expect(content).toContain('packages/core/src/engine.ts');
      expect(content).toContain('packages/ui/src/component.ts');
      expect(content).toContain('apps/web/src/main.ts');
      expect(containsValidMermaid(content)).toBe(true);
    });
  });
});