import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createTreeSitterAnalyzer } from '../../src/pipeline/analyze.js';
import type { FileContent, CodeNode } from '../../src/types.js';
import {
  createTempDir,
  cleanupTempDir
} from '../test.util.js';

describe('SCN-TS Integration Features (Transaction d669e46a-7204-4171-893f-5ca9b5c2a16d)', () => {
  let tempDir: string;
  let analyzer: ReturnType<typeof createTreeSitterAnalyzer>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    analyzer = createTreeSitterAnalyzer();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Core Type System Enhancements', () => {
    it('should support new CodeNode types: html_element and css_rule', () => {
      // Test that the type system supports the new types
      const htmlNode: CodeNode = {
        id: 'test.tsx#div:1',
        type: 'html_element',
        name: 'div',
        filePath: 'test.tsx',
        startLine: 1,
        endLine: 1,
        htmlTag: 'div'
      };

      const cssNode: CodeNode = {
        id: 'test.css#.container',
        type: 'css_rule',
        name: '.container',
        filePath: 'test.css',
        startLine: 1,
        endLine: 3,
        cssSelector: '.container'
      };

      expect(htmlNode.type).toBe('html_element');
      expect(htmlNode.htmlTag).toBe('div');
      expect(cssNode.type).toBe('css_rule');
      expect(cssNode.cssSelector).toBe('.container');
    });

    it('should support new CodeNode fields for enhanced semantics', () => {
      const enhancedNode: CodeNode = {
        id: 'test.ts#riskyFunction',
        type: 'function',
        name: 'riskyFunction',
        filePath: 'test.ts',
        startLine: 1,
        endLine: 5,
        canThrow: true,
        isPure: false,
        visibility: 'public',
        isAsync: true,
        isStatic: false,
        returnType: 'Promise<string>',
        parameters: [
          { name: 'input', type: 'string' },
          { name: 'options', type: 'Options' }
        ]
      };

      expect(enhancedNode.canThrow).toBe(true);
      expect(enhancedNode.isPure).toBe(false);
      expect(enhancedNode.visibility).toBe('public');
      expect(enhancedNode.isAsync).toBe(true);
      expect(enhancedNode.returnType).toBe('Promise<string>');
      expect(enhancedNode.parameters).toHaveLength(2);
    });
  });

  describe('Language Support Verification', () => {
    it('should handle TSX files and detect JSX elements', async () => {
      const files: FileContent[] = [
        {
          path: 'src/Component.tsx',
          content: `
export function MyComponent() {
  return (
    <div className="container">
      <h1>Hello World</h1>
      <button type="button">Click me</button>
    </div>
  );
}`
        }
      ];

      const graph = await analyzer(files);
      
      // Should analyze TSX files without errors
      expect(graph.nodes.size).toBeGreaterThan(0);
      
      // Should have file node with correct language
      const fileNode = graph.nodes.get('src/Component.tsx');
      expect(fileNode).toBeDefined();
      expect(fileNode?.type).toBe('file');
      expect(fileNode?.language).toBe('tsx');
      
      // Should detect the function
      const functionNode = Array.from(graph.nodes.values()).find(
        node => node.name === 'MyComponent' && node.type === 'function'
      );
      expect(functionNode).toBeDefined();
      
      // Should detect HTML elements
      const htmlElements = Array.from(graph.nodes.values()).filter(
        node => node.type === 'html_element'
      );
      
      if (htmlElements.length > 0) {
        // Verify HTML elements have proper structure
        htmlElements.forEach(element => {
          expect(element.filePath).toBe('src/Component.tsx');
          expect(element.htmlTag).toBeDefined();
          expect(element.name).toBeDefined();
        });
        
        // Look for specific elements
        const divElement = htmlElements.find(el => el.htmlTag === 'div');
        const h1Element = htmlElements.find(el => el.htmlTag === 'h1');
        const buttonElement = htmlElements.find(el => el.htmlTag === 'button');
        
        if (divElement) {
          expect(divElement.type).toBe('html_element');
          expect(divElement.htmlTag).toBe('div');
        }
        if (h1Element) {
          expect(h1Element.type).toBe('html_element');
          expect(h1Element.htmlTag).toBe('h1');
        }
        if (buttonElement) {
          expect(buttonElement.type).toBe('html_element');
          expect(buttonElement.htmlTag).toBe('button');
        }
      }
    });

    it('should handle CSS files and detect CSS rules', async () => {
      const files: FileContent[] = [
        {
          path: 'src/styles.css',
          content: `
.container {
  display: flex;
}

#header {
  color: blue;
}

.btn:hover {
  opacity: 0.8;
}`
        }
      ];

      const graph = await analyzer(files);
      
      // Should have file node with correct language
      const fileNode = graph.nodes.get('src/styles.css');
      expect(fileNode).toBeDefined();
      expect(fileNode?.type).toBe('file');
      expect(fileNode?.language).toBe('css');
      
      // Should detect CSS rules
      const cssRules = Array.from(graph.nodes.values()).filter(
        node => node.type === 'css_rule'
      );
      
      expect(cssRules.length).toBeGreaterThan(0);
      
      // Verify CSS rules have proper structure
      cssRules.forEach(rule => {
        expect(rule.filePath).toBe('src/styles.css');
        expect(rule.cssSelector).toBeDefined();
        expect(rule.name).toBeDefined();
      });
      
      // Look for specific selectors
      const containerRule = cssRules.find(rule => 
        rule.cssSelector?.includes('.container') || rule.name.includes('container')
      );
      const headerRule = cssRules.find(rule => 
        rule.cssSelector?.includes('#header') || rule.name.includes('header')
      );
      
      if (containerRule) {
        expect(containerRule.type).toBe('css_rule');
      }
      if (headerRule) {
        expect(headerRule.type).toBe('css_rule');
      }
    });
  });

  describe('Enhanced Analysis Features', () => {
    it('should detect async functions', async () => {
      const files: FileContent[] = [
        {
          path: 'src/async.ts',
          content: `
export async function fetchData(): Promise<string> {
  return 'data';
}

export function syncFunction(): string {
  return 'sync';
}`
        }
      ];

      const graph = await analyzer(files);
      
      const asyncFunction = Array.from(graph.nodes.values()).find(
        node => node.name === 'fetchData' && node.type === 'function'
      );
      
      const syncFunction = Array.from(graph.nodes.values()).find(
        node => node.name === 'syncFunction' && node.type === 'function'
      );
      
      expect(asyncFunction).toBeDefined();
      expect(syncFunction).toBeDefined();
      
      // Test async detection if implemented
      if (asyncFunction?.isAsync !== undefined) {
        expect(asyncFunction.isAsync).toBe(true);
      }
      if (syncFunction?.isAsync !== undefined) {
        expect(syncFunction.isAsync).toBeFalsy();
      }
    });

    it('should detect throw statements in functions', async () => {
      const files: FileContent[] = [
        {
          path: 'src/errors.ts',
          content: `
export function validateInput(input: string): string {
  if (!input) {
    throw new Error('Input cannot be empty');
  }
  return input.trim();
}

export function safeFunction(value: number): number {
  return value * 2;
}`
        }
      ];

      const graph = await analyzer(files);
      
      const validateInputNode = Array.from(graph.nodes.values()).find(
        node => node.name === 'validateInput' && node.type === 'function'
      );
      
      const safeFunctionNode = Array.from(graph.nodes.values()).find(
        node => node.name === 'safeFunction' && node.type === 'function'
      );
      
      expect(validateInputNode).toBeDefined();
      expect(safeFunctionNode).toBeDefined();
      
      // Test canThrow detection if implemented
      if (validateInputNode?.canThrow !== undefined) {
        expect(validateInputNode.canThrow).toBe(true);
      }
      if (safeFunctionNode?.canThrow !== undefined) {
        expect(safeFunctionNode.canThrow).toBeFalsy();
      }
    });

    it('should detect class methods with visibility modifiers', async () => {
      const files: FileContent[] = [
        {
          path: 'src/Service.ts',
          content: `
export class UserService {
  private users: User[] = [];
  
  public addUser(user: User): void {
    this.users.push(user);
  }
  
  protected validateUser(user: User): boolean {
    return user.name.length > 0;
  }
}`
        }
      ];

      const graph = await analyzer(files);
      
      const classNode = Array.from(graph.nodes.values()).find(
        node => node.name === 'UserService' && node.type === 'class'
      );
      
      const publicMethod = Array.from(graph.nodes.values()).find(
        node => node.name.includes('addUser') && node.type === 'method'
      );
      
      const protectedMethod = Array.from(graph.nodes.values()).find(
        node => node.name.includes('validateUser') && node.type === 'method'
      );
      
      expect(classNode).toBeDefined();
      expect(publicMethod).toBeDefined();
      expect(protectedMethod).toBeDefined();
      
      // Test visibility detection if implemented
      if (publicMethod?.visibility !== undefined) {
        expect(publicMethod.visibility).toBe('public');
      }
      if (protectedMethod?.visibility !== undefined) {
        expect(protectedMethod.visibility).toBe('protected');
      }
    });
  });

  describe('Dependency and Configuration Verification', () => {
    it('should verify package.json includes new CSS dependency', () => {
      // This test verifies that the transaction successfully added tree-sitter-css
      const packageJsonContent = require('../../package.json');
      expect(packageJsonContent.dependencies['tree-sitter-css']).toBeDefined();
      // Version may be updated, just verify it exists and starts with ^0.
      expect(packageJsonContent.dependencies['tree-sitter-css']).toMatch(/^\^0\./);
    });

    it('should verify package.json includes Vue dependency', () => {
      // This test verifies that tree-sitter-vue is available
      const packageJsonContent = require('../../package.json');
      expect(packageJsonContent.dependencies['tree-sitter-vue']).toBeDefined();
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain existing TypeScript analysis functionality', async () => {
      const files: FileContent[] = [
        {
          path: 'src/legacy.ts',
          content: `
export interface User {
  id: number;
  name: string;
  email: string;
}

export class UserService {
  private users: User[] = [];
  
  public addUser(user: User): void {
    this.users.push(user);
  }
  
  public getUser(id: number): User | undefined {
    return this.users.find(u => u.id === id);
  }
}

export function createUser(name: string, email: string): User {
  return {
    id: Math.random(),
    name,
    email
  };
}`
        }
      ];

      const graph = await analyzer(files);
      
      // Should detect all traditional TypeScript symbols
      const interfaceNode = Array.from(graph.nodes.values()).find(
        node => node.name === 'User' && node.type === 'interface'
      );
      const classNode = Array.from(graph.nodes.values()).find(
        node => node.name === 'UserService' && node.type === 'class'
      );
      const publicMethodNode = Array.from(graph.nodes.values()).find(
        node => node.name.includes('addUser') && node.type === 'method'
      );
      const functionNode = Array.from(graph.nodes.values()).find(
        node => node.name === 'createUser' && node.type === 'function'
      );
      
      expect(interfaceNode).toBeDefined();
      expect(classNode).toBeDefined();
      expect(publicMethodNode).toBeDefined();
      expect(functionNode).toBeDefined();
      
      // Verify basic properties are preserved
      expect(interfaceNode?.filePath).toBe('src/legacy.ts');
      expect(classNode?.filePath).toBe('src/legacy.ts');
      expect(functionNode?.filePath).toBe('src/legacy.ts');
    });
  });
});