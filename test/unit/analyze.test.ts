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
      expect(graph.nodes.size).toBeGreaterThan(0); // Should have nodes
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

      expect(graph.nodes.has('src/index.ts')).toBe(true);
      expect(graph.nodes.has('src/utils.ts')).toBe(true);

      const indexNode = graph.nodes.get('src/index.ts');
      expect(indexNode!.type).toBe('file');
      expect(indexNode!.name).toBe('index.ts');
      expect(indexNode!.filePath).toBe('src/index.ts');
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

      expect(graph.nodes.has('src/functions.ts#add')).toBe(true);
      expect(graph.nodes.has('src/functions.ts#multiply')).toBe(true);

      const addNode = graph.nodes.get('src/functions.ts#add');
      expect(addNode!.type).toBe('function');
      expect(addNode!.name).toBe('add');
      expect(addNode!.filePath).toBe('src/functions.ts');
      expect(addNode!.startLine).toBeGreaterThan(0);
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

      expect(graph.nodes.has('src/arrows.ts#greet')).toBe(true);
      expect(graph.nodes.has('src/arrows.ts#calculate')).toBe(true);

      const greetNode = graph.nodes.get('src/arrows.ts#greet');
      expect(greetNode!.type).toBe('arrow_function');
      expect(greetNode!.name).toBe('greet');
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

      expect(graph.nodes.has('src/classes.ts#Calculator')).toBe(true);
      expect(graph.nodes.has('src/classes.ts#Logger')).toBe(true);

      const calculatorNode = graph.nodes.get('src/classes.ts#Calculator');
      expect(calculatorNode!.type).toBe('class');
      expect(calculatorNode!.name).toBe('Calculator');
      expect(calculatorNode!.codeSnippet).toContain('export class Calculator');
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

      expect(graph.nodes.has('src/interfaces.ts#User')).toBe(true);
      expect(graph.nodes.has('src/interfaces.ts#Config')).toBe(true);

      const userNode = graph.nodes.get('src/interfaces.ts#User');
      expect(userNode!.type).toBe('interface');
      expect(userNode!.name).toBe('User');
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

      expect(graph.nodes.has('src/types.ts#Status')).toBe(true);
      expect(graph.nodes.has('src/types.ts#Handler')).toBe(true);
      expect(graph.nodes.has('src/types.ts#UserRole')).toBe(true);

      const statusNode = graph.nodes.get('src/types.ts#Status');
      expect(statusNode!.type).toBe('type');
      expect(statusNode!.name).toBe('Status');
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
      const hasCalculatorImport = graph.edges.some(e => e.fromId === 'src/index.ts' && e.toId === 'src/calculator.ts');
      const hasLoggerImport = graph.edges.some(e => e.fromId === 'src/index.ts' && e.toId === 'src/utils/logger.ts');
      
      expect(hasCalculatorImport).toBe(true);
      expect(hasLoggerImport).toBe(true);
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
      expect(graph.nodes.has('README.md')).toBe(true);
      expect(graph.nodes.has('src/empty.ts')).toBe(true);

      const readmeNode = graph.nodes.get('README.md');
      expect(readmeNode!.type).toBe('file');
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
      expect(graph.nodes.has('src/valid.ts')).toBe(true);
      expect(graph.nodes.has('src/invalid.ts')).toBe(true);
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

      const firstClass = graph.nodes.get('src/multiline.ts#FirstClass');
      const secondFunction = graph.nodes.get('src/multiline.ts#secondFunction');
      const thirdInterface = graph.nodes.get('src/multiline.ts#ThirdInterface');

      expect(firstClass!.startLine).toBe(3);
      expect(secondFunction!.startLine).toBe(9);
      expect(thirdInterface!.startLine).toBe(14);

      expect(firstClass!.endLine).toBeGreaterThan(firstClass!.startLine);
      expect(secondFunction!.endLine).toBeGreaterThan(secondFunction!.startLine);
      expect(thirdInterface!.endLine).toBeGreaterThan(thirdInterface!.startLine);
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

      const calculatorNode = graph.nodes.get('src/snippets.ts#Calculator');
      const multiplyNode = graph.nodes.get('src/snippets.ts#multiply');

      expect(calculatorNode!.codeSnippet).toContain('export class Calculator');
      expect(multiplyNode!.codeSnippet).toContain('export function multiply(a: number, b: number): number');
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
      const hasCalcImport = graph.edges.some(e => e.fromId === 'src/imports.ts' && e.toId === 'src/math/calculator.ts');
      const hasUtilsImport = graph.edges.some(e => e.fromId === 'src/imports.ts' && e.toId === 'src/utils.ts');
      const hasConfigImport = graph.edges.some(e => e.fromId === 'src/imports.ts' && e.toId === 'src/config.ts');
      const hasLoggerImport = graph.edges.some(e => e.fromId === 'src/imports.ts' && e.toId === 'src/logger.ts');
      expect(hasCalcImport).toBe(true);
      expect(hasUtilsImport).toBe(true);
      expect(hasConfigImport).toBe(true);
      expect(hasLoggerImport).toBe(true);
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
      expect(graph.nodes.has('src/nested.ts#OuterClass')).toBe(true);
      
      const outerClass = graph.nodes.get('src/nested.ts#OuterClass');
      expect(outerClass!.type).toBe('class');
      expect(outerClass!.name).toBe('OuterClass');
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

      const aToB = graph.edges.some(e => e.fromId === 'src/a.ts' && e.toId === 'src/b.ts');
      const bToA = graph.edges.some(e => e.fromId === 'src/b.ts' && e.toId === 'src/a.ts');
      
      expect(aToB).toBe(true);
      expect(bToA).toBe(true);
      expect(graph.nodes.has('src/a.ts#A')).toBe(true);
      expect(graph.nodes.has('src/b.ts#B')).toBe(true);
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
      const calculatorNodes = [...graph.nodes.keys()].filter((nodeId) =>
        nodeId.includes('#Calculator')
      );
      expect(calculatorNodes.length).toBe(1);
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

      expect(graph.nodes.size).toBe(fixture.expected_nodes!);
      
      // Check for specific symbols from the fixture
      expect(graph.nodes.has('src/calculator.ts#Calculator')).toBe(true);
      expect(graph.nodes.has('src/utils/logger.ts#Logger')).toBe(true);
      expect(graph.nodes.has('src/types.ts#Config')).toBe(true);
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
      expect(graph.nodes.has('src/database/index.ts#Database')).toBe(true);
      expect(graph.nodes.has('src/api/server.ts#ApiServer')).toBe(true);
      expect(graph.nodes.has('src/services/user.ts#UserService')).toBe(true);
      
      // Check for import relationships
      const serverToDb = graph.edges.some(e => e.fromId === 'src/api/server.ts' && e.toId === 'src/database/index.ts');
      const serverToUser = graph.edges.some(e => e.fromId === 'src/api/server.ts' && e.toId === 'src/services/user.ts');
      expect(serverToDb).toBe(true);
      expect(serverToUser).toBe(true);
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

      expect(graph.nodes.has('src/main.ts')).toBe(true);
      expect(graph.nodes.has('src/main.ts#hello')).toBe(true);
      expect(graph.nodes.has('src/main.ts#greet')).toBe(true);

      const helloNode = graph.nodes.get('src/main.ts#hello');
      const greetNode = graph.nodes.get('src/main.ts#greet');

      expect(helloNode!.type).toBe('function');
      expect(greetNode!.type).toBe('arrow_function');
    });
  });

  describe('Code Relationships', () => {
    it("should create a 'calls' edge when one function calls another", async () => {
      const files: FileContent[] = [
        {
          path: 'src/calls.ts',
          content: `function a() { console.log('a'); }
function b() { a(); }`
        }
      ];
      const graph = await analyzer(files);
      
      const hasCallEdge = graph.edges.some(
        e => e.fromId === 'src/calls.ts#b' && e.toId === 'src/calls.ts#a' && e.type === 'calls'
      );
      
      expect(hasCallEdge).toBe(true);
    });

    it("should create 'inherits' and 'implements' edges for class expressions", async () => {
      const files: FileContent[] = [
        {
          path: 'src/expressions.ts',
          content: `
interface IRunnable { run(): void; }
class Base {}
const MyClass = class extends Base implements IRunnable {
  run() {}
};`
        }
      ];
      const graph = await analyzer(files);

      const fromId = 'src/expressions.ts#MyClass';
      const inheritsEdge = graph.edges.some(
        e => e.fromId === fromId && e.toId === 'src/expressions.ts#Base' && e.type === 'inherits'
      );
      const implementsEdge = graph.edges.some(
        e => e.fromId === fromId && e.toId === 'src/expressions.ts#IRunnable' && e.type === 'implements'
      );
      
      expect(graph.nodes.has(fromId)).toBe(true);
      expect(inheritsEdge).toBe(true);
      expect(implementsEdge).toBe(true);
    });

    it("should correctly resolve module imports that omit the file extension", async () => {
      const files: FileContent[] = [
        {
          path: 'src/main.ts',
          content: "import { helper } from './utils'"
        },
        {
          path: 'src/utils.ts',
          content: 'export const helper = () => {};'
        }
      ];

      const graph = await analyzer(files);
      
      const hasImportEdge = graph.edges.some(
        e => e.fromId === 'src/main.ts' && e.toId === 'src/utils.ts' && e.type === 'imports'
      );

      expect(hasImportEdge).toBe(true);
    });
  });
});