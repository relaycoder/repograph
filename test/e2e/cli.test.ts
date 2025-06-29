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

describe('CLI End-to-End Tests', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  const runCLI = async (args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    return new Promise((resolve, reject) => {
      const child = spawn('bun', ['run', 'src/index.ts', ...args], {
        cwd: cwd || process.cwd(),
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code || 0
        });
      });

      child.on('error', reject);
    });
  };

  describe('Basic CLI Usage', () => {
    it('should generate map with default options', async () => {
      const files = {
        'src/index.ts': `export class Example {
  method(): string {
    return 'hello';
  }
}`
      };
      await createTestFiles(tempDir, files);

      const result = await runCLI([tempDir]);

      expect(result.exitCode).toBe(0);
      await assertFileExists(path.join(tempDir, 'repograph.md'));
      
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('Example');
    });

    it('should accept custom output path', async () => {
      const files = {
        'src/test.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const outputPath = path.join(tempDir, 'custom-output.md');
      const result = await runCLI([tempDir, '--output', outputPath]);

      expect(result.exitCode).toBe(0);
      await assertFileExists(outputPath);
    });

    it('should accept include patterns', async () => {
      const files = {
        'src/index.ts': 'export const ts = true;',
        'src/index.js': 'export const js = true;'
      };
      await createTestFiles(tempDir, files);

      const result = await runCLI([
        tempDir,
        '--include', '**/*.ts'
      ]);

      expect(result.exitCode).toBe(0);
      
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).toContain('src/index.ts');
      expect(content).not.toContain('src/index.js');
    });

    it('should accept ignore patterns', async () => {
      const files = {
        'src/index.ts': 'export const main = true;',
        'src/test.spec.ts': 'test code'
      };
      await createTestFiles(tempDir, files);

      const result = await runCLI([
        tempDir,
        '--ignore', '**/*.spec.ts'
      ]);

      expect(result.exitCode).toBe(0);
      
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).toContain('src/index.ts');
      expect(content).not.toContain('src/test.spec.ts');
    });

    it('should accept ranking strategy option', async () => {
      const files = {
        'src/index.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const result = await runCLI([
        tempDir,
        '--ranking-strategy', 'git-changes'
      ]);

      expect(result.exitCode).toBe(0);
      await assertFileExists(path.join(tempDir, 'repograph.md'));
    });

    it('should accept no-gitignore flag', async () => {
      const files = {
        'src/index.ts': 'export const main = true;',
        'dist/index.js': 'compiled code'
      };
      await createTestFiles(tempDir, files);
      await createGitignore(tempDir, ['dist/']);

      const result = await runCLI([
        tempDir,
        '--no-gitignore'
      ]);

      expect(result.exitCode).toBe(0);
      
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).toContain('dist/index.js');
    });

    it('should show help when --help flag is used', async () => {
      const result = await runCLI(['--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage:');
      expect(result.stdout).toContain('Options:');
    });

    it('should show version when --version flag is used', async () => {
      const result = await runCLI(['--version']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent directory', async () => {
      const nonExistentDir = path.join(tempDir, 'non-existent');
      const result = await runCLI([nonExistentDir]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('Error');
    });

    it('should handle invalid output directory', async () => {
      const files = {
        'src/index.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const invalidOutput = '/root/cannot-write-here.md';
      const result = await runCLI([
        tempDir,
        '--output', invalidOutput
      ]);

      expect(result.exitCode).not.toBe(0);
    });

    it('should handle invalid ranking strategy', async () => {
      const files = {
        'src/index.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const result = await runCLI([
        tempDir,
        '--ranking-strategy', 'invalid-strategy'
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('Invalid ranking strategy');
    });

    it('should handle malformed include patterns gracefully', async () => {
      const files = {
        'src/index.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const result = await runCLI([
        tempDir,
        '--include', '[invalid-pattern'
      ]);

      // Should not crash, but might produce empty output
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Multiple Arguments', () => {
    it('should handle multiple include patterns', async () => {
      const files = {
        'src/index.ts': 'export const ts = true;',
        'lib/utils.js': 'export const js = true;',
        'docs/readme.md': '# Documentation'
      };
      await createTestFiles(tempDir, files);

      const result = await runCLI([
        tempDir,
        '--include', '**/*.ts',
        '--include', '**/*.js'
      ]);

      expect(result.exitCode).toBe(0);
      
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).toContain('src/index.ts');
      expect(content).toContain('lib/utils.js');
      expect(content).not.toContain('docs/readme.md');
    });

    it('should handle multiple ignore patterns', async () => {
      const files = {
        'src/index.ts': 'export const main = true;',
        'src/test.spec.ts': 'test code',
        'src/utils.test.ts': 'test utils',
        'src/helper.ts': 'helper code'
      };
      await createTestFiles(tempDir, files);

      const result = await runCLI([
        tempDir,
        '--ignore', '**/*.spec.ts',
        '--ignore', '**/*.test.ts'
      ]);

      expect(result.exitCode).toBe(0);
      
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).toContain('src/index.ts');
      expect(content).toContain('src/helper.ts');
      expect(content).not.toContain('src/test.spec.ts');
      expect(content).not.toContain('src/utils.test.ts');
    });
  });

  describe('Output Customization Flags', () => {
    beforeEach(async () => {
      const files = {
        'src/index.ts': `import { helper, another, onemore } from './utils.js';
export function main() { helper(); another(); onemore(); }`,
        'src/utils.ts': `export function helper() {}
export function another() {}
export function onemore() {}`
      };
      await createTestFiles(tempDir, files);
    });

    it('should handle --no-header', async () => {
      await runCLI([tempDir, '--no-header']);
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).not.toContain('# RepoGraph');
    });
    
    it('should handle --no-overview', async () => {
      await runCLI([tempDir, '--no-overview']);
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).not.toContain('## 🚀 Project Overview');
    });

    it('should handle --no-mermaid', async () => {
      await runCLI([tempDir, '--no-mermaid']);
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).not.toContain('```mermaid');
    });

    it('should handle --no-file-list', async () => {
      await runCLI([tempDir, '--no-file-list']);
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).not.toContain('### Top 10 Most Important Files');
    });

    it('should handle --no-symbol-details', async () => {
      await runCLI([tempDir, '--no-symbol-details']);
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).not.toContain('## 📂 File & Symbol Breakdown');
    });
    
    it('should handle --top-file-count', async () => {
      await runCLI([tempDir, '--top-file-count', '1']);
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).toContain('### Top 1 Most Important Files');
    });

    it('should handle --file-section-separator', async () => {
      await runCLI([tempDir, '--file-section-separator', '***']);
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).toContain('\n***\n\n');
    });
    
    it('should handle --no-symbol-relations', async () => {
      await runCLI([tempDir, '--no-symbol-relations']);
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).not.toContain('(calls');
    });

    it('should handle --no-symbol-line-numbers', async () => {
      await runCLI([tempDir, '--no-symbol-line-numbers']);
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).not.toContain('_L2_');
    });

    it('should handle --no-symbol-snippets', async () => {
      await runCLI([tempDir, '--no-symbol-snippets']);
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).not.toContain('```typescript');
    });

    it('should handle --max-relations-to-show', async () => {
      await runCLI([tempDir, '--max-relations-to-show', '1']);
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).toContain('calls `helper`...');
      expect(content).not.toContain('`another`');
    });
  });

  describe('Output Validation', () => {
    it('should generate valid markdown structure', async () => {
      const files = {
        'src/calculator.ts': `export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}`,
        'src/logger.ts': `export class Logger {
  log(message: string): void {
    console.log(message);
  }
}`
      };
      await createTestFiles(tempDir, files);

      const result = await runCLI([tempDir]);

      expect(result.exitCode).toBe(0);
      
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      
      // Check markdown structure
      expect(content).toContain('# RepoGraph');
      expect(content).toContain('## 🚀 Project Overview');
      expect(content).toContain('### Module Dependency Graph');
      expect(content).toContain('### Top 10 Most Important Files');
      expect(content).toContain('## 📂 File & Symbol Breakdown');
      
      // Check Mermaid graph
      expect(containsValidMermaid(content)).toBe(true);
      
      // Check symbol details
      expect(content).toContain('Calculator');
      expect(content).toContain('Logger');
    });

    it('should handle projects with complex dependencies', async () => {
      const files = {
        'src/index.ts': `import { Database } from './database.js';
import { ApiServer } from './api.js';

export class App {
  constructor(
    private db: Database,
    private api: ApiServer
  ) {}
}`,
        'src/database.ts': `export class Database {
  connect(): Promise<void> {
    return Promise.resolve();
  }
}`,
        'src/api.ts': `import { Database } from './database.js';

export class ApiServer {
  constructor(private db: Database) {}
}`
      };
      await createTestFiles(tempDir, files);

      const result = await runCLI([tempDir]);

      expect(result.exitCode).toBe(0);
      
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).toContain('App');
      expect(content).toContain('Database');
      expect(content).toContain('ApiServer');
      expect(containsValidMermaid(content)).toBe(true);
    });
  });

  describe('Integration with Fixtures', () => {
    it('should process sample-project fixture via CLI', async () => {
      const fixture = await loadFixture('sample-project');
      await createProjectFromFixture(tempDir, fixture);

      const result = await runCLI([
        tempDir,
        '--include', '**/*.ts'
      ]);

      expect(result.exitCode).toBe(0);
      
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('Calculator');
      expect(content).toContain('Logger');
      expect(content).toContain('AdvancedCalculator');
    });

    it('should process complex-project fixture via CLI', async () => {
      const fixture = await loadFixture('complex-project');
      await createProjectFromFixture(tempDir, fixture);

      const result = await runCLI([
        tempDir,
        '--include', '**/*.ts',
        '--ranking-strategy', 'pagerank'
      ]);

      expect(result.exitCode).toBe(0);
      
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('Database');
      expect(content).toContain('ApiServer');
      expect(content).toContain('UserService');
    });

    it('should handle minimal-project fixture via CLI', async () => {
      const fixture = await loadFixture('minimal-project');
      await createProjectFromFixture(tempDir, fixture);

      const result = await runCLI([tempDir]);

      expect(result.exitCode).toBe(0);
      
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('src/main.ts');
      expect(content).toContain('hello');
      expect(content).toContain('greet');
    });
  });

  describe('Performance', () => {
    it('should handle moderately large projects in reasonable time', async () => {
      // Create a project with many files
      const files: Record<string, string> = {};
      
      for (let i = 0; i < 30; i++) {
        files[`src/module${i}.ts`] = `export class Module${i} {
  process(): string {
    return 'module${i}';
  }
}`;
      }

      // Add some imports
      files['src/index.ts'] = Array.from({ length: 30 }, (_, i) => 
        `import { Module${i} } from './module${i}.js';`
      ).join('\n') + '\n\nexport const modules = [' + 
      Array.from({ length: 30 }, (_, i) => `Module${i}`).join(', ') + '];';

      await createTestFiles(tempDir, files);

      const startTime = Date.now();
      const result = await runCLI([tempDir]);
      const endTime = Date.now();

      expect(result.exitCode).toBe(0);
      expect(endTime - startTime).toBeLessThan(15000); // Should complete within 15 seconds
      
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).toContain('Module0');
      expect(content).toContain('Module29');
    });
  });

  describe('Real-world Scenarios', () => {
    it('should work with TypeScript project structure', async () => {
      const files = {
        'package.json': JSON.stringify({
          name: 'my-project',
          version: '1.0.0',
          type: 'module',
          scripts: {
            build: 'tsc',
            test: 'bun test'
          }
        }, null, 2),
        'tsconfig.json': JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            outDir: './dist'
          }
        }, null, 2),
        'src/index.ts': `export { Calculator } from './lib/calculator.js';
export type { CalculatorOptions } from './types.js';`,
        'src/lib/calculator.ts': `import type { CalculatorOptions } from '../types.js';

export class Calculator {
  constructor(private options: CalculatorOptions) {}
  
  calculate(expression: string): number {
    return eval(expression);
  }
}`,
        'src/types.ts': `export interface CalculatorOptions {
  precision: number;
  mode: 'strict' | 'loose';
}`,
        'README.md': '# My Calculator Project'
      };
      await createTestFiles(tempDir, files);

      const result = await runCLI([
        tempDir,
        '--include', 'src/**/*.ts'
      ]);

      expect(result.exitCode).toBe(0);
      
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).toContain('Calculator');
      expect(content).toContain('CalculatorOptions');
      expect(content).not.toContain('package.json');
      expect(content).not.toContain('README.md');
    });

    it('should work with monorepo structure', async () => {
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
  private engine = new Engine();
  
  render(): void {
    this.engine.start();
  }
}`,
        'apps/web/src/main.ts': `import { Component } from '../../../packages/ui/src/component.js';

const component = new Component();
component.render();`
      };
      await createTestFiles(tempDir, files);

      const result = await runCLI([
        tempDir,
        '--include', '**/*.ts'
      ]);

      expect(result.exitCode).toBe(0);
      
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).toContain('Engine');
      expect(content).toContain('Component');
      expect(content).toContain('packages/core/src/engine.ts');
      expect(content).toContain('packages/ui/src/component.ts');
      expect(content).toContain('apps/web/src/main.ts');
    });

    it('should respect gitignore in real project', async () => {
      const files = {
        'src/index.ts': 'export const main = true;',
        'src/utils.ts': 'export const util = true;',
        'dist/index.js': 'compiled code',
        'node_modules/package/index.js': 'dependency',
        'coverage/lcov.info': 'coverage data',
        '.env': 'SECRET=value',
        'logs/app.log': 'log content'
      };
      await createTestFiles(tempDir, files);
      await createGitignore(tempDir, [
        'dist/',
        'node_modules/',
        'coverage/',
        '.env',
        'logs/'
      ]);

      const result = await runCLI([tempDir]);

      expect(result.exitCode).toBe(0);
      
      const content = await readFile(path.join(tempDir, 'repograph.md'));
      expect(content).toContain('src/index.ts');
      expect(content).toContain('src/utils.ts');
      expect(content).not.toContain('dist/index.js');
      expect(content).not.toContain('node_modules/package/index.js');
      expect(content).not.toContain('coverage/lcov.info');
      expect(content).not.toContain('.env');
      expect(content).not.toContain('logs/app.log');
    });
  });
});