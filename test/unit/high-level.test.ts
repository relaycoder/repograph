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

describe('High-Level API', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('generateMap()', () => {
    it('should be a function', () => {
      expect(typeof generateMap).toBe('function');
    });

    it('should accept RepoGraphOptions parameter', async () => {
      const files = {
        'src/test.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const options: RepoGraphOptions = {
        root: tempDir,
        output: path.join(tempDir, 'test.md')
      };

      await generateMap(options);
      // If we get here without throwing, the test passes
    });

    it('should use default values for missing options', async () => {
      const files = {
        'src/test.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const originalCwd = process.cwd();
      
      try {
        process.chdir(tempDir);
        await generateMap();
        await assertFileExists(path.join(tempDir, 'repograph.md'));
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should validate ranking strategy option', async () => {
      const files = {
        'src/test.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const options: RepoGraphOptions = {
        root: tempDir,
        output: path.join(tempDir, 'test.md'),
        rankingStrategy: 'invalid-strategy' as any
      };

      await expect(generateMap(options)).rejects.toThrow('Invalid ranking strategy');
    });

    it('should accept valid ranking strategies', async () => {
      const files = {
        'src/test.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const pageRankOptions: RepoGraphOptions = {
        root: tempDir,
        output: path.join(tempDir, 'pagerank.md'),
        rankingStrategy: 'pagerank'
      };

      const gitOptions: RepoGraphOptions = {
        root: tempDir,
        output: path.join(tempDir, 'git.md'),
        rankingStrategy: 'git-changes'
      };

      await generateMap(pageRankOptions);
      await generateMap(gitOptions);
      // If we get here without throwing, the test passes
    });

    it('should pass through all options to pipeline', async () => {
      const files = {
        'src/index.ts': 'export const ts = true;',
        'src/index.js': 'export const js = true;',
        'src/test.spec.ts': 'test code'
      };
      await createTestFiles(tempDir, files);

      const options: RepoGraphOptions = {
        root: tempDir,
        output: path.join(tempDir, 'filtered.md'),
        include: ['**/*.ts'],
        ignore: ['**/*.spec.ts'],
        noGitignore: true,
        rankingStrategy: 'pagerank',
        rendererOptions: {
          customHeader: '# Custom Header',
          includeMermaidGraph: false,
          includeSymbolDetails: false
        }
      };

      await generateMap(options);

      const content = await readFile(path.join(tempDir, 'filtered.md'));
      expect(content).toStartWith('# Custom Header');
      expect(content).toContain('src/index.ts');
      expect(content).not.toContain('src/index.js');
      expect(content).not.toContain('src/test.spec.ts');
      expect(content).not.toContain('```mermaid');
    });

    it('should handle relative paths correctly', async () => {
      const files = {
        'project/src/test.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const projectDir = path.join(tempDir, 'project');
      const relativePath = path.relative(process.cwd(), projectDir);

      const options: RepoGraphOptions = {
        root: relativePath,
        output: path.join(tempDir, 'relative.md')
      };

      await generateMap(options);
      await assertFileExists(path.join(tempDir, 'relative.md'));
    });

    it('should create output directory if it does not exist', async () => {
      const files = {
        'src/test.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const nestedOutput = path.join(tempDir, 'nested', 'deep', 'output.md');
      
      const options: RepoGraphOptions = {
        root: tempDir,
        output: nestedOutput
      };

      await generateMap(options);
      await assertFileExists(nestedOutput);
    });

    it('should handle empty projects gracefully', async () => {
      const options: RepoGraphOptions = {
        root: tempDir,
        output: path.join(tempDir, 'empty.md')
      };

      await generateMap(options);

      const content = await readFile(path.join(tempDir, 'empty.md'));
      expect(isValidMarkdown(content)).toBe(true);
      expect(content).toContain('This repository contains 0 nodes (0 files)');
    });

    it('should handle projects with only non-code files', async () => {
      const files = {
        'README.md': '# Project',
        'package.json': '{"name": "test"}',
        'LICENSE': 'MIT License'
      };
      await createTestFiles(tempDir, files);

      const options: RepoGraphOptions = {
        root: tempDir,
        output: path.join(tempDir, 'non-code.md'),
        include: ['**/*.ts', '**/*.js'] // Only include code files
      };

      await generateMap(options);

      const content = await readFile(path.join(tempDir, 'non-code.md'));
      expect(content).toContain('This repository contains 0 nodes (0 files)');
    });
  });

  describe('Error Handling', () => {
    it('should throw error for non-existent root directory', async () => {
      const options: RepoGraphOptions = {
        root: path.join(tempDir, 'non-existent'),
        output: path.join(tempDir, 'error.md')
      };

      await expect(generateMap(options)).rejects.toThrow();
    });

    it('should throw error for invalid output path', async () => {
      const files = {
        'src/test.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const options: RepoGraphOptions = {
        root: tempDir,
        output: '/root/cannot-write-here.md'
      };

      await expect(generateMap(options)).rejects.toThrow();
    });

    it('should handle malformed include patterns gracefully', async () => {
      const files = {
        'src/test.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const options: RepoGraphOptions = {
        root: tempDir,
        output: path.join(tempDir, 'malformed.md'),
        include: ['[invalid-pattern']
      };

      // Should not throw, but may result in empty output
      await generateMap(options);
    });

    it('should validate renderer options', async () => {
      const files = {
        'src/test.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const options: RepoGraphOptions = {
        root: tempDir,
        output: path.join(tempDir, 'test.md'),
        rendererOptions: {
          customHeader: '', // Empty header should be handled
          includeMermaidGraph: true,
          includeSymbolDetails: true
        }
      };

      await generateMap(options);
    });
  });

  describe('Option Validation', () => {
    it('should accept all valid RepoGraphOptions properties', async () => {
      const files = {
        'src/test.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const completeOptions: RepoGraphOptions = {
        root: tempDir,
        output: path.join(tempDir, 'complete.md'),
        include: ['**/*.ts'],
        ignore: ['**/*.spec.ts'],
        noGitignore: false,
        rankingStrategy: 'pagerank',
        rendererOptions: {
          customHeader: '# Test Project',
          includeMermaidGraph: true,
          includeSymbolDetails: true
        }
      };

      await generateMap(completeOptions);
    });

    it('should handle partial options correctly', async () => {
      const files = {
        'src/test.ts': 'export const test = true;'
      };
      await createTestFiles(tempDir, files);

      const minimalOptions: RepoGraphOptions = {
        root: tempDir
      };

      await generateMap(minimalOptions);
    });

    it('should handle empty options object', async () => {
      const originalCwd = process.cwd();
      
      try {
        process.chdir(tempDir);
        
        const files = {
          'src/test.ts': 'export const test = true;'
        };
        await createTestFiles(tempDir, files);

        await generateMap({});
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('Integration with Components', () => {
    it('should use default pipeline components', async () => {
      const files = {
        'src/calculator.ts': `export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}`,
        'src/index.ts': `import { Calculator } from './calculator.js';
export { Calculator };`
      };
      await createTestFiles(tempDir, files);

      const options: RepoGraphOptions = {
        root: tempDir,
        output: path.join(tempDir, 'default-components.md')
      };

      await generateMap(options);

      const content = await readFile(path.join(tempDir, 'default-components.md'));
      
      // Should contain results from all pipeline stages
      expect(content).toContain('Calculator'); // From analysis
      expect(content).toContain('```mermaid'); // From rendering
      expect(content).toContain('src/calculator.ts'); // From discovery
    });

    it('should work with different ranking strategies', async () => {
      const files = {
        'src/hub.ts': 'export class Hub {}',
        'src/a.ts': `import { Hub } from './hub.js';`,
        'src/b.ts': `import { Hub } from './hub.js';`
      };
      await createTestFiles(tempDir, files);

      const pageRankOptions: RepoGraphOptions = {
        root: tempDir,
        output: path.join(tempDir, 'pagerank.md'),
        rankingStrategy: 'pagerank'
      };

      const gitOptions: RepoGraphOptions = {
        root: tempDir,
        output: path.join(tempDir, 'git.md'),
        rankingStrategy: 'git-changes'
      };

      await generateMap(pageRankOptions);
      await generateMap(gitOptions);

      const pageRankContent = await readFile(path.join(tempDir, 'pagerank.md'));
      const gitContent = await readFile(path.join(tempDir, 'git.md'));

      expect(isValidMarkdown(pageRankContent)).toBe(true);
      expect(isValidMarkdown(gitContent)).toBe(true);
      
      // Both should contain the same files but potentially different rankings
      expect(pageRankContent).toContain('Hub');
      expect(gitContent).toContain('Hub');
    });
  });

  describe('Performance', () => {
    it('should handle reasonable project sizes efficiently', async () => {
      const files: Record<string, string> = {};
      
      // Create 20 files with some dependencies
      for (let i = 0; i < 20; i++) {
        files[`src/module${i}.ts`] = `export class Module${i} {
  getValue(): number {
    return ${i};
  }
}`;
      }

      // Add an index file that imports everything
      files['src/index.ts'] = Array.from({ length: 20 }, (_, i) => 
        `import { Module${i} } from './module${i}.js';`
      ).join('\n');

      await createTestFiles(tempDir, files);

      const startTime = Date.now();
      
      const options: RepoGraphOptions = {
        root: tempDir,
        output: path.join(tempDir, 'performance.md')
      };

      await generateMap(options);
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds

      const content = await readFile(path.join(tempDir, 'performance.md'));
      expect(content).toContain('Module0');
      expect(content).toContain('Module19');
    });
  });
});