import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createTreeSitterAnalyzer } from '../../src/pipeline/analyze.js';
import type { FileContent, CodeNodeVisibility } from '../../src/types.js';
import {
  createTempDir,
  cleanupTempDir,
} from '../test.util.js';

describe('CodeNode Qualifiers Enhancement (scn-ts integration)', () => {
  let tempDir: string;
  let analyzer: ReturnType<typeof createTreeSitterAnalyzer>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    analyzer = createTreeSitterAnalyzer();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('Function Qualifiers', () => {
    it('should detect async functions with parameters and return types', async () => {
      const files: FileContent[] = [
        {
          path: 'src/async-functions.ts',
          content: `export async function fetchUser(id: number, options?: RequestOptions): Promise<User> {
  return await api.get(\`/users/\${id}\`, options);
}

async function processData(data: string[]): Promise<void> {
  for (const item of data) {
    await process(item);
  }
}`
        }
      ];

      const graph = await analyzer(files);

      const fetchUserNode = graph.nodes.get('src/async-functions.ts#fetchUser');
      const processDataNode = graph.nodes.get('src/async-functions.ts#processData');

      expect(fetchUserNode).toBeDefined();
      expect(fetchUserNode!.isAsync).toBe(true);
      expect(fetchUserNode!.returnType).toBe('Promise<User>');
      expect(fetchUserNode!.parameters).toEqual([
        { name: 'id', type: 'number' },
        { name: 'options', type: 'RequestOptions' }
      ]);

      expect(processDataNode).toBeDefined();
      expect(processDataNode!.isAsync).toBe(true);
      expect(processDataNode!.returnType).toBe('Promise<void>');
      expect(processDataNode!.parameters).toEqual([
        { name: 'data', type: 'string[]' }
      ]);
    });

    it('should detect regular functions with parameters and return types', async () => {
      const files: FileContent[] = [
        {
          path: 'src/regular-functions.ts',
          content: `export function calculateSum(numbers: number[]): number {
  return numbers.reduce((sum, num) => sum + num, 0);
}

function formatMessage(template: string, ...args: any[]): string {
  return template.replace(/{(\d+)}/g, (match, index) => args[index]);
}`
        }
      ];

      const graph = await analyzer(files);

      const calculateSumNode = graph.nodes.get('src/regular-functions.ts#calculateSum');
      const formatMessageNode = graph.nodes.get('src/regular-functions.ts#formatMessage');

      expect(calculateSumNode).toBeDefined();
      expect(calculateSumNode!.isAsync).toBeUndefined();
      expect(calculateSumNode!.returnType).toBe('number');
      expect(calculateSumNode!.parameters).toEqual([
        { name: 'numbers', type: 'number[]' }
      ]);

      expect(formatMessageNode).toBeDefined();
      expect(formatMessageNode!.isAsync).toBeUndefined();
      expect(formatMessageNode!.returnType).toBe('string');
      expect(formatMessageNode!.parameters).toEqual([
        { name: 'template', type: 'string' },
        { name: '...args', type: 'any[]' }
      ]);
    });

    it('should detect arrow functions with async and type annotations', async () => {
      const files: FileContent[] = [
        {
          path: 'src/arrow-functions.ts',
          content: `export const asyncArrow = async (data: string): Promise<boolean> => {
  const result = await validate(data);
  return result.isValid;
};

const syncArrow = (x: number, y: number): number => x + y;

export const noParamsArrow = (): void => {
  console.log('No parameters');
};`
        }
      ];

      const graph = await analyzer(files);

      const asyncArrowNode = graph.nodes.get('src/arrow-functions.ts#asyncArrow');
      const syncArrowNode = graph.nodes.get('src/arrow-functions.ts#syncArrow');
      const noParamsArrowNode = graph.nodes.get('src/arrow-functions.ts#noParamsArrow');

      expect(asyncArrowNode).toBeDefined();
      expect(asyncArrowNode!.isAsync).toBe(true);
      expect(asyncArrowNode!.returnType).toBe('Promise<boolean>');
      expect(asyncArrowNode!.parameters).toEqual([
        { name: 'data', type: 'string' }
      ]);

      expect(syncArrowNode).toBeDefined();
      expect(syncArrowNode!.isAsync).toBeUndefined();
      expect(syncArrowNode!.returnType).toBe('number');
      expect(syncArrowNode!.parameters).toEqual([
        { name: 'x', type: 'number' },
        { name: 'y', type: 'number' }
      ]);

      expect(noParamsArrowNode).toBeDefined();
      expect(noParamsArrowNode!.isAsync).toBeUndefined();
      expect(noParamsArrowNode!.returnType).toBe('void');
      expect(noParamsArrowNode!.parameters).toEqual([]);
    });
  });

  describe('Class Method Qualifiers', () => {
    it('should detect method visibility modifiers', async () => {
      const files: FileContent[] = [
        {
          path: 'src/class-methods.ts',
          content: `export class UserService {
  public async getUser(id: string): Promise<User> {
    return await this.repository.findById(id);
  }

  private validateUser(user: User): boolean {
    return user.email && user.name;
  }

  protected formatUserData(user: User): UserData {
    return {
      id: user.id,
      displayName: user.name
    };
  }

  static createDefault(): UserService {
    return new UserService(new DefaultRepository());
  }

  public static async initialize(config: Config): Promise<UserService> {
    const repo = await createRepository(config);
    return new UserService(repo);
  }
}`
        }
      ];

      const graph = await analyzer(files);

      const getUserNode = graph.nodes.get('src/class-methods.ts#getUser');
      const validateUserNode = graph.nodes.get('src/class-methods.ts#validateUser');
      const formatUserDataNode = graph.nodes.get('src/class-methods.ts#formatUserData');
      const createDefaultNode = graph.nodes.get('src/class-methods.ts#createDefault');
      const initializeNode = graph.nodes.get('src/class-methods.ts#initialize');

      expect(getUserNode).toBeDefined();
      expect(getUserNode!.visibility).toBe('public');
      expect(getUserNode!.isAsync).toBe(true);
      expect(getUserNode!.isStatic).toBeUndefined();
      expect(getUserNode!.returnType).toBe('Promise<User>');
      expect(getUserNode!.parameters).toEqual([
        { name: 'id', type: 'string' }
      ]);

      expect(validateUserNode).toBeDefined();
      expect(validateUserNode!.visibility).toBe('private');
      expect(validateUserNode!.isAsync).toBeUndefined();
      expect(validateUserNode!.isStatic).toBeUndefined();
      expect(validateUserNode!.returnType).toBe('boolean');

      expect(formatUserDataNode).toBeDefined();
      expect(formatUserDataNode!.visibility).toBe('protected');
      expect(formatUserDataNode!.isAsync).toBeUndefined();
      expect(formatUserDataNode!.isStatic).toBeUndefined();
      expect(formatUserDataNode!.returnType).toBe('UserData');

      expect(createDefaultNode).toBeDefined();
      expect(createDefaultNode!.isStatic).toBe(true);
      expect(createDefaultNode!.isAsync).toBeUndefined();
      expect(createDefaultNode!.returnType).toBe('UserService');

      expect(initializeNode).toBeDefined();
      expect(initializeNode!.visibility).toBe('public');
      expect(initializeNode!.isStatic).toBe(true);
      expect(initializeNode!.isAsync).toBe(true);
      expect(initializeNode!.returnType).toBe('Promise<UserService>');
    });

    it('should handle methods without explicit visibility (default public)', async () => {
      const files: FileContent[] = [
        {
          path: 'src/default-visibility.ts',
          content: `export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  async compute(operation: string): Promise<number> {
    return await this.performOperation(operation);
  }

  static getInstance(): Calculator {
    return new Calculator();
  }
}`
        }
      ];

      const graph = await analyzer(files);

      const addNode = graph.nodes.get('src/default-visibility.ts#add');
      const computeNode = graph.nodes.get('src/default-visibility.ts#compute');
      const getInstanceNode = graph.nodes.get('src/default-visibility.ts#getInstance');

      expect(addNode).toBeDefined();
      expect(addNode!.visibility).toBeUndefined(); // No explicit modifier
      expect(addNode!.isAsync).toBeUndefined();
      expect(addNode!.isStatic).toBeUndefined();

      expect(computeNode).toBeDefined();
      expect(computeNode!.visibility).toBeUndefined();
      expect(computeNode!.isAsync).toBe(true);
      expect(computeNode!.isStatic).toBeUndefined();

      expect(getInstanceNode).toBeDefined();
      expect(getInstanceNode!.visibility).toBeUndefined();
      expect(getInstanceNode!.isAsync).toBeUndefined();
      expect(getInstanceNode!.isStatic).toBe(true);
    });
  });

  describe('Class Field Qualifiers', () => {
    it('should detect field visibility and static modifiers', async () => {
      const files: FileContent[] = [
        {
          path: 'src/class-fields.ts',
          content: `export class DataStore {
  public readonly name: string;
  private data: Map<string, any>;
  protected config: Configuration;
  static defaultInstance: DataStore;
  public static readonly version: string = '1.0.0';

  private static cache: WeakMap<object, DataStore> = new WeakMap();
}`
        }
      ];

      const graph = await analyzer(files);

      const nameNode = graph.nodes.get('src/class-fields.ts#name');
      const dataNode = graph.nodes.get('src/class-fields.ts#data');
      const configNode = graph.nodes.get('src/class-fields.ts#config');
      const defaultInstanceNode = graph.nodes.get('src/class-fields.ts#defaultInstance');
      const versionNode = graph.nodes.get('src/class-fields.ts#version');
      const cacheNode = graph.nodes.get('src/class-fields.ts#cache');

      expect(nameNode).toBeDefined();
      expect(nameNode!.visibility).toBe('public');
      expect(nameNode!.isStatic).toBeUndefined();
      expect(nameNode!.returnType).toBe('string');

      expect(dataNode).toBeDefined();
      expect(dataNode!.visibility).toBe('private');
      expect(dataNode!.isStatic).toBeUndefined();
      expect(dataNode!.returnType).toBe('Map<string, any>');

      expect(configNode).toBeDefined();
      expect(configNode!.visibility).toBe('protected');
      expect(configNode!.isStatic).toBeUndefined();
      expect(configNode!.returnType).toBe('Configuration');

      expect(defaultInstanceNode).toBeDefined();
      expect(defaultInstanceNode!.isStatic).toBe(true);
      expect(defaultInstanceNode!.returnType).toBe('DataStore');

      expect(versionNode).toBeDefined();
      expect(versionNode!.visibility).toBe('public');
      expect(versionNode!.isStatic).toBe(true);
      expect(versionNode!.returnType).toBe('string');

      expect(cacheNode).toBeDefined();
      expect(cacheNode!.visibility).toBe('private');
      expect(cacheNode!.isStatic).toBe(true);
      expect(cacheNode!.returnType).toBe('WeakMap<object, DataStore>');
    });
  });

  describe('Complex Parameter Types', () => {
    it('should handle complex parameter types and optional parameters', async () => {
      const files: FileContent[] = [
        {
          path: 'src/complex-params.ts',
          content: `export function processRequest(
  request: HttpRequest,
  options?: {
    timeout?: number;
    retries?: number;
  },
  callback: (error: Error | null, result?: any) => void
): Promise<Response> {
  return new Promise((resolve, reject) => {
    // Implementation
  });
}

export async function batchProcess<T>(
  items: T[],
  processor: (item: T) => Promise<ProcessResult>,
  concurrency: number = 5
): Promise<BatchResult<T>> {
  // Implementation
  return {} as BatchResult<T>;
}`
        }
      ];

      const graph = await analyzer(files);

      const processRequestNode = graph.nodes.get('src/complex-params.ts#processRequest');
      const batchProcessNode = graph.nodes.get('src/complex-params.ts#batchProcess');

      expect(processRequestNode).toBeDefined();
      expect(processRequestNode!.isAsync).toBeUndefined();
      expect(processRequestNode!.returnType).toBe('Promise<Response>');
      expect(processRequestNode!.parameters).toEqual([
        { name: 'request', type: 'HttpRequest' },
        { name: 'options', type: '{\n    timeout?: number;\n    retries?: number;\n  }' },
        { name: 'callback', type: '(error: Error | null, result?: any) => void' }
      ]);

      expect(batchProcessNode).toBeDefined();
      expect(batchProcessNode!.isAsync).toBe(true);
      expect(batchProcessNode!.returnType).toBe('Promise<BatchResult<T>>');
      expect(batchProcessNode!.parameters).toEqual([
        { name: 'items', type: 'T[]' },
        { name: 'processor', type: '(item: T) => Promise<ProcessResult>' },
        { name: 'concurrency', type: 'number' }
      ]);
    });

    it('should handle destructured parameters', async () => {
      const files: FileContent[] = [
        {
          path: 'src/destructured-params.ts',
          content: `export function createUser(
  { name, email, age }: { name: string; email: string; age?: number },
  options: UserOptions = {}
): User {
  return new User(name, email, age, options);
}

export const updateProfile = async (
  userId: string,
  { profile, settings }: { profile: ProfileData; settings?: UserSettings }
): Promise<void> => {
  await userService.update(userId, profile, settings);
};`
        }
      ];

      const graph = await analyzer(files);

      const createUserNode = graph.nodes.get('src/destructured-params.ts#createUser');
      const updateProfileNode = graph.nodes.get('src/destructured-params.ts#updateProfile');

      expect(createUserNode).toBeDefined();
      expect(createUserNode!.isAsync).toBeUndefined();
      expect(createUserNode!.returnType).toBe('User');
      expect(createUserNode!.parameters).toEqual([
        { name: '{ name, email, age }', type: '{ name: string; email: string; age?: number }' },
        { name: 'options', type: 'UserOptions' }
      ]);

      expect(updateProfileNode).toBeDefined();
      expect(updateProfileNode!.isAsync).toBe(true);
      expect(updateProfileNode!.returnType).toBe('Promise<void>');
      expect(updateProfileNode!.parameters).toEqual([
        { name: 'userId', type: 'string' },
        { name: '{ profile, settings }', type: '{ profile: ProfileData; settings?: UserSettings }' }
      ]);
    });
  });

  describe('Edge Cases and Compatibility', () => {
    it('should handle functions without type annotations gracefully', async () => {
      const files: FileContent[] = [
        {
          path: 'src/no-types.ts',
          content: `export function legacyFunction(data) {
  return data.toString();
}

export const arrowWithoutTypes = (x, y) => x + y;

export async function asyncWithoutTypes(input) {
  return await process(input);
}`
        }
      ];

      const graph = await analyzer(files);

      const legacyNode = graph.nodes.get('src/no-types.ts#legacyFunction');
      const arrowNode = graph.nodes.get('src/no-types.ts#arrowWithoutTypes');
      const asyncNode = graph.nodes.get('src/no-types.ts#asyncWithoutTypes');

      expect(legacyNode).toBeDefined();
      expect(legacyNode!.isAsync).toBeUndefined();
      expect(legacyNode!.returnType).toBeUndefined();
      expect(legacyNode!.parameters).toEqual([
        { name: 'data', type: undefined }
      ]);

      expect(arrowNode).toBeDefined();
      expect(arrowNode!.isAsync).toBeUndefined();
      expect(arrowNode!.returnType).toBeUndefined();
      expect(arrowNode!.parameters).toEqual([
        { name: 'x', type: undefined },
        { name: 'y', type: undefined }
      ]);

      expect(asyncNode).toBeDefined();
      expect(asyncNode!.isAsync).toBe(true);
      expect(asyncNode!.returnType).toBeUndefined();
      expect(asyncNode!.parameters).toEqual([
        { name: 'input', type: undefined }
      ]);
    });

    it('should maintain backward compatibility for existing CodeNode fields', async () => {
      const files: FileContent[] = [
        {
          path: 'src/compatibility.ts',
          content: `export class TestClass {
  public method(): void {}
}

export function testFunction(): string {
  return 'test';
}

export interface TestInterface {
  prop: number;
}`
        }
      ];

      const graph = await analyzer(files);

      const classNode = graph.nodes.get('src/compatibility.ts#TestClass');
      const methodNode = graph.nodes.get('src/compatibility.ts#method');
      const functionNode = graph.nodes.get('src/compatibility.ts#testFunction');
      const interfaceNode = graph.nodes.get('src/compatibility.ts#TestInterface');

      // Verify all original fields are still present
      expect(classNode).toBeDefined();
      expect(classNode!.id).toBe('src/compatibility.ts#TestClass');
      expect(classNode!.type).toBe('class');
      expect(classNode!.name).toBe('TestClass');
      expect(classNode!.filePath).toBe('src/compatibility.ts');
      expect(classNode!.startLine).toBeGreaterThan(0);
      expect(classNode!.endLine).toBeGreaterThan(0);
      expect(classNode!.codeSnippet).toBeDefined();

      // Verify new fields are present but don't break existing functionality
      expect(methodNode).toBeDefined();
      expect(methodNode!.visibility).toBe('public');
      expect(methodNode!.isAsync).toBeUndefined();
      expect(methodNode!.isStatic).toBeUndefined();

      expect(functionNode).toBeDefined();
      expect(functionNode!.returnType).toBe('string');
      expect(functionNode!.parameters).toEqual([]);

      expect(interfaceNode).toBeDefined();
      expect(interfaceNode!.type).toBe('interface');
      // New fields should be undefined for interfaces (as expected)
      expect(interfaceNode!.visibility).toBeUndefined();
      expect(interfaceNode!.isAsync).toBeUndefined();
      expect(interfaceNode!.isStatic).toBeUndefined();
    });
  });

  describe('SCN-TS Integration Mapping', () => {
    it('should provide data that maps to SCN notation correctly', async () => {
      const files: FileContent[] = [
        {
          path: 'src/scn-mapping.ts',
          content: `export class ApiController {
  // Maps to SCN: +method(param: string): Promise<Response> ...
  public async handleRequest(param: string): Promise<Response> {
    return await this.process(param);
  }

  // Maps to SCN: -validate(data: any): boolean
  private validate(data: any): boolean {
    return !!data;
  }

  // Maps to SCN: +static create(): ApiController
  public static create(): ApiController {
    return new ApiController();
  }
}`
        }
      ];

      const graph = await analyzer(files);

      const handleRequestNode = graph.nodes.get('src/scn-mapping.ts#handleRequest');
      const validateNode = graph.nodes.get('src/scn-mapping.ts#validate');
      const createNode = graph.nodes.get('src/scn-mapping.ts#create');

      // Verify mapping to SCN '+' (public), '...' (async), '#(type)' (return type)
      expect(handleRequestNode).toBeDefined();
      expect(handleRequestNode!.visibility).toBe('public'); // Maps to SCN '+'
      expect(handleRequestNode!.isAsync).toBe(true); // Maps to SCN '...'
      expect(handleRequestNode!.returnType).toBe('Promise<Response>'); // Maps to SCN '#(type)'
      expect(handleRequestNode!.parameters).toEqual([
        { name: 'param', type: 'string' }
      ]);

      // Verify mapping to SCN '-' (private)
      expect(validateNode).toBeDefined();
      expect(validateNode!.visibility).toBe('private'); // Maps to SCN '-'
      expect(validateNode!.isAsync).toBeUndefined();
      expect(validateNode!.returnType).toBe('boolean');

      // Verify static mapping
      expect(createNode).toBeDefined();
      expect(createNode!.visibility).toBe('public');
      expect(createNode!.isStatic).toBe(true); // Static indicator
      expect(createNode!.isAsync).toBeUndefined();
      expect(createNode!.returnType).toBe('ApiController');
    });
  });
});