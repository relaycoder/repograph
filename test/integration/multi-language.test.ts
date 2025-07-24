import { describe, it, expect } from 'bun:test';
import { runAnalyzerForTests } from '../test.util.js';
import type { FileContent } from '../../src/types.js';

interface TestCase {
  language: string;
  files: FileContent[];
  expectedNodeIds: string[];
  expectedEdges?: Array<{ from: string; to: string; type: 'imports' | 'inherits' | 'implements' }>;
}

describe('Multi-Language Support', () => {
  const testCases: TestCase[] = [
    {
      language: 'TypeScript Relationships',
      files: [
        { path: 'src/base.ts', content: 'export class Base {}; export interface ILog { log(): void; }' },
        { path: 'src/main.ts', content: "import { Base } from './base'; export class Main extends Base implements ILog { log() {} }" },
      ],
      expectedNodeIds: ['src/base.ts', 'src/base.ts#Base', 'src/base.ts#ILog', 'src/main.ts', 'src/main.ts#Main'],
      expectedEdges: [
        { from: 'src/main.ts', to: 'src/base.ts', type: 'imports' },
        { from: 'src/main.ts#Main', to: 'src/base.ts#Base', type: 'inherits' },
        { from: 'src/main.ts#Main', to: 'src/base.ts#ILog', type: 'implements' },
      ],
    },
    {
      language: 'Python Relationships',
      files: [
        { path: 'src/models/base.py', content: 'class Base:\n  pass' },
        { path: 'src/models/user.py', content: 'from .base import Base\n\nclass User(Base):\n  pass' },
      ],
      expectedNodeIds: ['src/models/base.py', 'src/models/base.py#Base', 'src/models/user.py', 'src/models/user.py#User'],
      expectedEdges: [
        { from: 'src/models/user.py', to: 'src/models/base.py', type: 'imports' },
        { from: 'src/models/user.py#User', to: 'src/models/base.py#Base', type: 'inherits' },
      ],
    },
    {
      language: 'Java Relationships',
      files: [
        { path: 'com/example/Base.java', content: 'package com.example; public class Base {}' },
        { path: 'com/example/Iface.java', content: 'package com.example; public interface Iface {}' },
        { path: 'com/example/Main.java', content: 'package com.example; import com.example.Base; public class Main extends Base implements Iface {}' },
      ],
      expectedNodeIds: [
        'com/example/Base.java', 'com/example/Base.java#Base',
        'com/example/Iface.java', 'com/example/Iface.java#Iface',
        'com/example/Main.java', 'com/example/Main.java#Main',
      ],
      expectedEdges: [
        { from: 'com/example/Main.java', to: 'com/example/Base.java', type: 'imports' },
        { from: 'com/example/Main.java#Main', to: 'com/example/Base.java#Base', type: 'inherits' },
        { from: 'com/example/Main.java#Main', to: 'com/example/Iface.java#Iface', type: 'implements' },
      ]
    },
    {
        language: 'Rust Relationships',
        files: [
            { path: 'src/utils.rs', content: 'pub fn helper() {}' },
            { path: 'src/main.rs', content: 'mod utils; use utils::helper; fn main() { helper(); }' }
        ],
        expectedNodeIds: [
            'src/utils.rs', 'src/utils.rs#helper',
            'src/main.rs', 'src/main.rs#main'
        ],
        expectedEdges: [
            { from: 'src/main.rs', to: 'src/utils.rs', type: 'imports' }
        ]
    },
  ];

  it.each(testCases)('should correctly analyze $language', async ({ files, expectedNodeIds, expectedEdges }: TestCase) => {
    const graph = await runAnalyzerForTests(files);

    // Verify all expected nodes exist
    for (const nodeId of expectedNodeIds) {
      expect(graph.nodes.has(nodeId)).toBe(true);
    }

    // Verify all expected edges exist
    if (expectedEdges) {
      for (const edge of expectedEdges) {
        const hasEdge = graph.edges.some(
          (e) => e.fromId === edge.from && e.toId === edge.to && e.type === edge.type
        );
        expect(hasEdge).toBe(true);
      }
    }
  });

  it('should handle unsupported file types gracefully alongside supported ones', async () => {
    const files: FileContent[] = [
      { path: 'src/code.ts', content: `export const hello = 'world';` },
      { path: 'README.md', content: '# This is markdown' },
      { path: 'config.json', content: '{"key": "value"}' }
    ];

    const graph = await runAnalyzerForTests(files);
    
    expect(graph.nodes.has('src/code.ts')).toBe(true);
    expect(graph.nodes.has('src/code.ts#hello')).toBe(true);
    expect(graph.nodes.has('README.md')).toBe(true);
    expect(graph.nodes.has('config.json')).toBe(true);

    // Should not create symbol nodes for non-code files
    expect(graph.nodes.size).toBe(4);
  });
});