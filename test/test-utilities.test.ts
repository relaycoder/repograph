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

describe('Test Utilities', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('File System Utilities', () => {
    it('should create and cleanup temporary directories', async () => {
      expect(tempDir).toBeDefined();
      expect(tempDir).toContain('repograph-test-');
    });

    it('should create test files', async () => {
      const files = {
        'src/index.ts': 'export const test = true;',
        'README.md': '# Test Project'
      };

      await createTestFiles(tempDir, files);
      const allFiles = await readAllFiles(tempDir);

      expect(allFiles.length).toBe(2);
      expect(allFiles.find(f => f.path === 'src/index.ts')?.content).toBe('export const test = true;');
      expect(allFiles.find(f => f.path === 'README.md')?.content).toBe('# Test Project');
    });

    it('should create gitignore files', async () => {
      await createGitignore(tempDir, ['node_modules/', '*.log']);
      const allFiles = await readAllFiles(tempDir);

      const gitignoreFile = allFiles.find(f => f.path === '.gitignore');
      expect(gitignoreFile).toBeDefined();
      expect(gitignoreFile?.content).toContain('node_modules/');
      expect(gitignoreFile?.content).toContain('*.log');
    });
  });

  describe('Validation Utilities', () => {
    it('should validate markdown content', () => {
      const validMarkdown = '# Title\n\nThis is valid markdown.';
      const invalidMarkdown = 'Just plain text without headers';

      expect(isValidMarkdown(validMarkdown)).toBe(true);
      expect(isValidMarkdown(invalidMarkdown)).toBe(false);
    });

    it('should detect valid Mermaid graphs', () => {
      const withMermaid = '# Title\n\n```mermaid\ngraph TD\nA --> B\n```';
      const withoutMermaid = '# Title\n\nJust regular markdown.';

      expect(containsValidMermaid(withMermaid)).toBe(true);
      expect(containsValidMermaid(withoutMermaid)).toBe(false);
    });

    it('should extract file paths from markdown', () => {
      const markdown = `
# Project
Files: \`src/index.ts\`, \`lib/utils.js\`, and \`README.md\`.
Also \`src/components/Button.tsx\`.
      `;

      const paths = extractFilePathsFromMarkdown(markdown);
      expect(paths).toContain('src/index.ts');
      expect(paths).toContain('lib/utils.js');
      expect(paths).toContain('src/components/Button.tsx');
      expect(paths).not.toContain('README.md'); // Not a .ts/.js file
    });
  });

  describe('Fixture Utilities', () => {
    it('should load sample-project fixture', async () => {
      const fixture = await loadFixture('sample-project');

      expect(fixture.name).toBe('Sample TypeScript Project');
      expect(fixture.files).toBeDefined();
      expect(fixture.files.length).toBeGreaterThan(0);
      expect(fixture.expected_nodes).toBeDefined();
      expect(fixture.expected_files).toBeDefined();
    });

    it('should create project from fixture', async () => {
      const fixture = await loadFixture('minimal-project');
      await createProjectFromFixture(tempDir, fixture);

      const allFiles = await readAllFiles(tempDir);
      expect(allFiles.length).toBe(fixture.files.length);

      const mainFile = allFiles.find(f => f.path === 'src/main.ts');
      expect(mainFile).toBeDefined();
      expect(mainFile?.content).toContain('export function hello()');
    });

    it('should handle fixture with gitignore', async () => {
      const fixture = await loadFixture('complex-project');
      await createProjectFromFixture(tempDir, fixture);

      const allFiles = await readAllFiles(tempDir);
      const gitignoreFile = allFiles.find(f => f.path === '.gitignore');

      expect(gitignoreFile).toBeDefined();
      expect(gitignoreFile?.content).toContain('node_modules');
      expect(gitignoreFile?.content).toContain('tests/**');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty directories', async () => {
      const allFiles = await readAllFiles(tempDir);
      expect(allFiles.length).toBe(0);
    });

    it('should handle nested directory structures', async () => {
      const files = {
        'src/components/ui/Button.tsx': 'export const Button = () => {};',
        'src/utils/helpers/format.ts': 'export const format = () => {};',
        'docs/api/endpoints.md': '# API Endpoints'
      };

      await createTestFiles(tempDir, files);
      const allFiles = await readAllFiles(tempDir);

      expect(allFiles.length).toBe(3);
      expect(allFiles.find(f => f.path === 'src/components/ui/Button.tsx')).toBeDefined();
      expect(allFiles.find(f => f.path === 'src/utils/helpers/format.ts')).toBeDefined();
      expect(allFiles.find(f => f.path === 'docs/api/endpoints.md')).toBeDefined();
    });

    it('should normalize file paths consistently', async () => {
      const files = {
        'src\\windows\\style\\path.ts': 'export const test = true;'
      };

      await createTestFiles(tempDir, files);
      const allFiles = await readAllFiles(tempDir);

      expect(allFiles).toHaveLength(1);
      // Should normalize to forward slashes
      expect(allFiles[0]!.path).toBe('src/windows/style/path.ts');
    });
  });
});
