import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createTreeSitterAnalyzer } from '../../src/pipeline/analyze.js';
import type { FileContent } from '../../src/types.js';
import {
  createTempDir,
  cleanupTempDir,
  loadFixture,
  createProjectFromFixture
} from '../test.util.js';

describe('Tree-sitter Analysis', () => {
  let tempDir: string;
  let analyzer: ReturnType<typeof createTreeSitterAnalyzer>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    analyzer = createTreeSitterAnalyzer();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('createTreeSitterAnalyzer()', () => {
    it('should return an Analyzer function', () => {
      expect(typeof analyzer).toBe('function');
    });

    it('should create a CodeGraph from file content', async () => {
      const files: FileContent[] = [
        {
          path: 'src/index.ts',
          content: `export function hello(): string {
  return 'Hello, World!';
}`
        }
      ];

      const graph = await analyzer(files);

      expect(graph).toBeDefined();
      expect(graph.order).toBeGreaterThan(0); // Should have nodes
    });

    it('should add file nodes to the graph', async () => {
      const files: FileContent[] = [
        {
          path: 'src/index.ts',
          content: 'export const hello = "world";'
        },
        {
          path: 'src/utils.ts',
          content: 'export const util = () => {};'
        }
      ];

      const graph = await analyzer(files);

      expect(graph.hasNode('src/index.ts')).toBe(true);
      expect(graph.hasNode('src/utils.ts')).toBe(true);

      const indexNode = graph.getNodeAttributes('src/index.ts');
      expect(indexNode.type).toBe('file');
      expect(indexNode.name).toBe('index.ts');
      expect(indexNode.filePath).toBe('src/index.ts');
    });

    it('should identify function declarations', async () => {
      const files: FileContent[] = [
        {
          path: 'src/functions.ts',
          content: `export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(x: number, y: number): number {
  return x * y;
}`
        }
      ];

      const graph = await analyzer(files);

      expect(graph.hasNode('src/functions.ts#add')).toBe(true);
      expect(graph.hasNode('src/functions.ts#multiply')).toBe(true);

      const addNode = graph.getNodeAttributes('src/functions.ts#add');
      expect(addNode.type).toBe('function');
      expect(addNode.name).toBe('add');
      expect(addNode.filePath).toBe('src/functions.ts');
      expect(addNode.startLine).toBeGreaterThan(0);
    });

    it('should identify arrow function declarations', async () => {
      const files: FileContent[] = [
        {
          path: 'src/arrows.ts',
          content: `export const greet = (name: string): string => {
  return \`Hello, \${name}!\`;
};

const calculate = (x: number, y: number): number => x + y;`
        }
      ];

      const graph = await analyzer(files);

      expect(graph.hasNode('src/arrows.ts#greet')).toBe(true);
      expect(graph.hasNode('src/arrows.ts#calculate')).toBe(true);

      const greetNode = graph.getNodeAttributes('src/arrows.ts#greet');
      expect(greetNode.type).toBe('arrow_function');
      expect(greetNode.name).toBe('greet');
    });

    it('should identify class declarations', async () => {
      const files: FileContent[] = [
        {
          path: 'src/classes.ts',
          content: `export class Calculator {
  private value: number = 0;
  
  add(n: number): this {
    this.value += n;
    return this;
  }
}

class Logger {
  log(message: string): void {
    console.log(message);
  }
}`
        }
      ];

      const graph = await analyzer(files);

      expect(graph.hasNode('src/classes.ts#Calculator')).toBe(true);
      expect(graph.hasNode('src/classes.ts#Logger')).toBe(true);

      const calculatorNode = graph.getNodeAttributes('src/classes.ts#Calculator');
      expect(calculatorNode.type).toBe('class');
      expect(calculatorNode.name).toBe('Calculator');
      expect(calculatorNode.codeSnippet).toContain('export class Calculator');
    });

    it('should identify interface declarations', async () => {
      const files: FileContent[] = [
        {
          path: 'src/interfaces.ts',
          content: `export interface User {
  id: number;
  name: string;
  email: string;
}

interface Config {
  debug: boolean;
  version: string;
}`
        }
      ];

      const graph = await analyzer(files);

      expect(graph.hasNode('src/interfaces.ts#User')).toBe(true);
      expect(graph.hasNode('src/interfaces.ts#Config')).toBe(true);

      const userNode = graph.getNodeAttributes('src/interfaces.ts#User');
      expect(userNode.type).toBe('interface');
      expect(userNode.name).toBe('User');
    });

    it('should identify type alias declarations', async () => {
      const files: FileContent[] = [
        {
          path: 'src/types.ts',
          content: `export type Status = 'active' | 'inactive' | 'pending';

type Handler = (event: Event) => void;

export type UserRole = 'admin' | 'user' | 'guest';`
        }
      ];

      const graph = await analyzer(files);

      expect(graph.hasNode('src/types.ts#Status')).toBe(true);
      expect(graph.hasNode('src/types.ts#Handler')).toBe(true);
      expect(graph.hasNode('src/types.ts#UserRole')).toBe(true);

      const statusNode = graph.getNodeAttributes('src/types.ts#Status');
      expect(statusNode.type).toBe('type');
      expect(statusNode.name).toBe('Status');
    });

    it('should identify import statements and create edges', async () => {
      const files: FileContent[] = [
        {
          path: 'src/index.ts',
          content: `import { Calculator } from './calculator.js';
import { Logger } from './utils/logger.js';

export { Calculator, Logger };`
        },
        {
          path: 'src/calculator.ts',
          content: `export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}`
        },
        {
          path: 'src/utils/logger.ts',
          content: `export class Logger {
  log(message: string): void {
    console.log(message);
  }
}`
        }
      ];

      const graph = await analyzer(files);

      // Check if import edges exist
      expect(graph.hasEdge('src/index.ts', 'src/calculator.ts')).toBe(true);
      expect(graph.hasEdge('src/index.ts', 'src/utils/logger.ts')).toBe(true);
    });

    it('should create edges from files to their symbols', async () => {
      const files: FileContent[] = [
        {
          path: 'src/example.ts',
          content: `export class Example {
  method(): void {}
}

export function helper(): string {
  return 'help';
}`
        }
      ];

      const graph = await analyzer(files);

      // Check if contains edges exist
      expect(graph.hasEdge('src/example.ts', 'src/example.ts#Example')).toBe(true);
      expect(graph.hasEdge('src/example.ts', 'src/example.ts#helper')).toBe(true);
    });

    it('should handle files with no symbols gracefully', async () => {
      const files: FileContent[] = [
        {
          path: 'README.md',
          content: '# Project\n\nThis is a readme file.'
        },
        {
          path: 'src/empty.ts',
          content: '// This file is empty\n'
        }
      ];

      const graph = await analyzer(files);

      // Should still create file nodes
      expect(graph.hasNode('README.md')).toBe(true);
      expect(graph.hasNode('src/empty.ts')).toBe(true);

      const readmeNode = graph.getNodeAttributes('README.md');
      expect(readmeNode.type).toBe('file');
    });

    it('should handle malformed or unparseable files gracefully', async () => {
      const files: FileContent[] = [
        {
          path: 'src/valid.ts',
          content: 'export const valid = true;'
        },
        {
          path: 'src/invalid.ts',
          content: 'this is not valid typescript syntax {'
        }
      ];

      const graph = await analyzer(files);

      // Should still create file nodes for both
      expect(graph.hasNode('src/valid.ts')).toBe(true);
      expect(graph.hasNode('src/invalid.ts')).toBe(true);
    });

    it('should set correct line numbers for symbols', async () => {
      const files: FileContent[] = [
        {
          path: 'src/multiline.ts',
          content: `// Line 1
// Line 2
export class FirstClass {
  // Line 4
  method(): void {}
}

// Line 8
export function secondFunction(): string {
  return 'hello';
}

// Line 13
export interface ThirdInterface {
  prop: string;
}`
        }
      ];

      const graph = await analyzer(files);

      const firstClass = graph.getNodeAttributes('src/multiline.ts#FirstClass');
      const secondFunction = graph.getNodeAttributes('src/multiline.ts#secondFunction');
      const thirdInterface = graph.getNodeAttributes('src/multiline.ts#ThirdInterface');

      expect(firstClass.startLine).toBe(3);
      expect(secondFunction.startLine).toBe(9);
      expect(thirdInterface.startLine).toBe(14);

      expect(firstClass.endLine).toBeGreaterThan(firstClass.startLine);
      expect(secondFunction.endLine).toBeGreaterThan(secondFunction.startLine);
      expect(thirdInterface.endLine).toBeGreaterThan(thirdInterface.startLine);
    });

    it('should include code snippets for symbols', async () => {
      const files: FileContent[] = [
        {
          path: 'src/snippets.ts',
          content: `export class Calculator {
  private value: number = 0;
  
  add(n: number): this {
    this.value += n;
    return this;
  }
}

export function multiply(a: number, b: number): number {
  return a * b;
}`
        }
      ];

      const graph = await analyzer(files);

      const calculatorNode = graph.getNodeAttributes('src/snippets.ts#Calculator');
      const multiplyNode = graph.getNodeAttributes('src/snippets.ts#multiply');

      expect(calculatorNode.codeSnippet).toContain('export class Calculator');
      expect(multiplyNode.codeSnippet).toContain('export function multiply(a: number, b: number): number');
    });

    it('should handle complex import patterns', async () => {
      const files: FileContent[] = [
        {
          path: 'src/imports.ts',
          content: `import { Calculator } from './math/calculator.js';
import * as utils from './utils.js';
import type { Config } from './config.js';
import Logger, { LogLevel } from './logger.js';`
        },
        {
          path: 'src/math/calculator.ts',
          content: 'export class Calculator {}'
        },
        {
          path: 'src/utils.ts',
          content: 'export const helper = () => {};'
        },
        {
          path: 'src/config.ts',
          content: 'export interface Config {}'
        },
        {
          path: 'src/logger.ts',
          content: 'export default class Logger {}'
        }
      ];

      const graph = await analyzer(files);

      // Check import edges
      expect(graph.hasEdge('src/imports.ts', 'src/math/calculator.ts')).toBe(true);
      expect(graph.hasEdge('src/imports.ts', 'src/utils.ts')).toBe(true);
      expect(graph.hasEdge('src/imports.ts', 'src/config.ts')).toBe(true);
      expect(graph.hasEdge('src/imports.ts', 'src/logger.ts')).toBe(true);
    });

    it('should handle nested class and function definitions', async () => {
      const files: FileContent[] = [
        {
          path: 'src/nested.ts',
          content: `export class OuterClass {
  private inner = class InnerClass {
    method(): void {}
  };
  
  outerMethod(): void {
    function nestedFunction(): string {
      return 'nested';
    }
    nestedFunction();
  }
}`
        }
      ];

      const graph = await analyzer(files);

      // Should identify the outer class
      expect(graph.hasNode('src/nested.ts#OuterClass')).toBe(true);
      
      const outerClass = graph.getNodeAttributes('src/nested.ts#OuterClass');
      expect(outerClass.type).toBe('class');
      expect(outerClass.name).toBe('OuterClass');
    });
  });

  describe('Graph Structure', () => {
    it('should create a directed graph', async () => {
      const files: FileContent[] = [
        {
          path: 'src/test.ts',
          content: 'export const test = true;'
        }
      ];

      const graph = await analyzer(files);

      expect(graph.type).toBe('directed');
      expect(graph.multi).toBe(true);
      expect(graph.allowSelfLoops).toBe(false);
    });

    it('should not create duplicate nodes for the same symbol', async () => {
      const files: FileContent[] = [
        {
          path: 'src/duplicate.ts',
          content: `export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}

// This should not create a duplicate
export class Calculator {
  multiply(a: number, b: number): number {
    return a * b;
  }
}`
        }
      ];

      const graph = await analyzer(files);

      // Should only have one Calculator node (first one wins)
      const calculatorNodes = graph.filterNodes((nodeId) => 
        nodeId.includes('#Calculator')
      );
      expect(calculatorNodes.length).toBe(1);
    });

    it('should handle circular imports gracefully', async () => {
      const files: FileContent[] = [
        {
          path: 'src/a.ts',
          content: `import { B } from './b.js';
export class A {
  b: B;
}`
        },
        {
          path: 'src/b.ts',
          content: `import { A } from './a.js';
export class B {
  a: A;
}`
        }
      ];

      const graph = await analyzer(files);

      expect(graph.hasEdge('src/a.ts', 'src/b.ts')).toBe(true);
      expect(graph.hasEdge('src/b.ts', 'src/a.ts')).toBe(true);
      expect(graph.hasNode('src/a.ts#A')).toBe(true);
      expect(graph.hasNode('src/b.ts#B')).toBe(true);
    });
  });

  describe('Integration with Fixtures', () => {
    it('should analyze sample-project fixture correctly', async () => {
      const fixture = await loadFixture('sample-project');
      await createProjectFromFixture(tempDir, fixture);

      const files: FileContent[] = [];
      for (const file of fixture.files) {
        if (file.path.endsWith('.ts')) {
          files.push({
            path: file.path,
            content: file.content
          });
        }
      }

      const graph = await analyzer(files);

      expect(graph.order).toBe(fixture.expected_nodes!);
      
      // Check for specific symbols from the fixture
      expect(graph.hasNode('src/calculator.ts#Calculator')).toBe(true);
      expect(graph.hasNode('src/utils/logger.ts#Logger')).toBe(true);
      expect(graph.hasNode('src/types.ts#Config')).toBe(true);
    });

    it('should analyze complex-project fixture correctly', async () => {
      const fixture = await loadFixture('complex-project');
      await createProjectFromFixture(tempDir, fixture);

      const files: FileContent[] = [];
      for (const file of fixture.files) {
        if (file.path.endsWith('.ts') && !file.path.includes('test')) {
          files.push({
            path: file.path,
            content: file.content
          });
        }
      }

      const graph = await analyzer(files);

      // Check for key classes and interfaces
      expect(graph.hasNode('src/database/index.ts#Database')).toBe(true);
      expect(graph.hasNode('src/api/server.ts#ApiServer')).toBe(true);
      expect(graph.hasNode('src/services/user.ts#UserService')).toBe(true);
      
      // Check for import relationships
      expect(graph.hasEdge('src/api/server.ts', 'src/database/index.ts')).toBe(true);
      expect(graph.hasEdge('src/api/server.ts', 'src/services/user.ts')).toBe(true);
    });

    it('should handle minimal-project fixture', async () => {
      const fixture = await loadFixture('minimal-project');
      await createProjectFromFixture(tempDir, fixture);

      const files: FileContent[] = [
        {
          path: 'src/main.ts',
          content: fixture.files[0]!.content
        }
      ];

      const graph = await analyzer(files);

      expect(graph.hasNode('src/main.ts')).toBe(true);
      expect(graph.hasNode('src/main.ts#hello')).toBe(true);
      expect(graph.hasNode('src/main.ts#greet')).toBe(true);

      const helloNode = graph.getNodeAttributes('src/main.ts#hello');
      const greetNode = graph.getNodeAttributes('src/main.ts#greet');

      expect(helloNode.type).toBe('function');
      expect(greetNode.type).toBe('arrow_function');
    });
  });
});