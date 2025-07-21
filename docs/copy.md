rules you have to follow: docs/scn.readme.md
1. No SCN-specific logic in repograph, Repograph focuses on analysis, scn-ts on notation
2. Stay scn v.1.0 compliant as the single source of truth
3. if the problem lies in repograph, you should fix repograph/src do not make any adjustment on scm-ts for repograph imperfection

address below `bun test test/ts` problems and bun test in repograph

test/ts/integration/css-parsing.test.ts:
1/3 Discovering files...
  -> Found 1 files to analyze.
2/3 Analyzing code and building graph...
  -> Built graph with 5 nodes and 0 edges.
3/3 Ranking graph nodes...
  -> Ranking complete.
35 |       `,
36 |     });
37 |     const scn = await generateScn({ root: project.projectDir, include: ['**/*.css'] });
38 |
39 |     // The order of intent symbols is sorted alphabetically by the serializer.
40 |     expect(scn).toContain('  ¶ (1.1) .layout-only { 📐 }');
                     ^
error: expect(received).toContain(expected)

Expected to contain: "  ¶ (1.1) .layout-only { 📐 }"
Received: "§ (1) styles.css\n  ¶ (1.1) .layout-only\n  ¶ (1.2) .text-only\n  ¶ (1.3) .appearance-only\n  ¶ (1.4) .all-intents"

      at <anonymous> (/home/realme-book/Project/code/scn-ts/test/ts/integration/css-parsing.test.ts:40:17)
✗ SCN Generation: 1.7 CSS Parsing & Integration > should generate a ¶ CSS Rule for each selector and include intent symbols [9.00ms]
1/3 Discovering files...
  -> Found 2 files to analyze.
2/3 Analyzing code and building graph...
ParserError: [tsx] Failed to process tsx files
   language: "tsx",

      at new RepoGraphError (/home/realme-book/Project/code/scn-ts/repograph/src/utils/error.util.ts:3:5)

QueryError: Bad pattern structure at offset 2923: 'value: (string) @css.class.reference'...
   kind: 5,
   info: {
  suffix: "2923: 'value: (string) @css.class.reference'...",
},
  index: 2923,
 length: 0,

      at new QueryError (/home/realme-book/Project/code/scn-ts/repograph/node_modules/web-tree-sitter/tree-sitter.js:1207:5)

  -> Built graph with 4 nodes and 0 edges.
3/3 Ranking graph nodes...
  -> Ranking complete.
70 |
71 |     expect(cssScn).toBeDefined();
72 |     expect(tsxScn).toBeDefined();
73 |
74 |     // Check file-level links
75 |     expect(cssScn!).toContain('§ (1) Button.css\n  <- (2.0)');
                         ^
error: expect(received).toContain(expected)

Expected to contain: "§ (1) Button.css\n  <- (2.0)"
Received: "§ (1) Button.css\n  ¶ (1.1) .btn\n  ¶ (1.2) .btn-primary"

      at <anonymous> (/home/realme-book/Project/code/scn-ts/test/ts/integration/css-parsing.test.ts:75:21)
✗ SCN Generation: 1.7 CSS Parsing & Integration > should create links between a JSX element and CSS rules via className [54.02ms]
1/3 Discovering files...
  -> Found 2 files to analyze.
2/3 Analyzing code and building graph...
ParserError: [tsx] Failed to process tsx files
   language: "tsx",

      at new RepoGraphError (/home/realme-book/Project/code/scn-ts/repograph/src/utils/error.util.ts:3:5)

QueryError: Bad pattern structure at offset 2923: 'value: (string) @css.class.reference'...
   kind: 5,
   info: {
  suffix: "2923: 'value: (string) @css.class.reference'...",
},
  index: 2923,
 length: 0,

      at new QueryError (/home/realme-book/Project/code/scn-ts/repograph/node_modules/web-tree-sitter/tree-sitter.js:1207:5)

  -> Built graph with 3 nodes and 0 edges.
3/3 Ranking graph nodes...
  -> Ranking complete.
112 |     expect(cssScn).toBeDefined();
113 |     expect(tsxScn).toBeDefined();
114 |
115 |     // Check entity-level links
116 |     // ⛶ div (2.2) should link to #main-container (1.1)
117 |     expect(tsxScn!).toContain('    ⛶ (2.2) div [ id:#main-container ]\n      -> (1.1)');
                          ^
error: expect(received).toContain(expected)

Expected to contain: "    ⛶ (2.2) div [ id:#main-container ]\n      -> (1.1)"
Received: "§ (2) App.tsx"

      at <anonymous> (/home/realme-book/Project/code/scn-ts/test/ts/integration/css-parsing.test.ts:117:21)
✗ SCN Generation: 1.7 CSS Parsing & Integration > should create links between a JSX element and a CSS rule via id [45.01ms]

 18 pass
 3 fail
 42 expect() calls
Ran 21 tests across 4 files. [1144.00ms]
realme-book@realme-book:~/Project/code/scn-ts$

480 |         }
481 |       }
482 |
483 |       const graph = await analyzer(files);
484 |
485 |       expect(graph.nodes.size).toBe(fixture.expected_nodes!);
                                     ^
error: expect(received).toBe(expected)

Expected: 40
Received: 28

      at <anonymous> (/home/realme-book/Project/code/scn-ts/repograph/test/unit/analyze.test.ts:485:32)
✗ Tree-sitter Analysis > Integration with Fixtures > should analyze sample-project fixture correctly [37.99ms]


ParserError: [tsx] Failed to process tsx files
   language: "tsx",

      at new RepoGraphError (/home/realme-book/Project/code/scn-ts/repograph/src/utils/error.util.ts:3:5)

QueryError: Bad pattern structure at offset 2923: 'value: (string) @css.class.reference'...
   kind: 5,
   info: {
  suffix: "2923: 'value: (string) @css.class.reference'...",
},
  index: 2923,
 length: 0,

      at new QueryError (/home/realme-book/Project/code/scn-ts/repograph/node_modules/web-tree-sitter/tree-sitter.js:1207:5)

107 |
108 |       // Should detect the function
109 |       const functionNode = Array.from(graph.nodes.values()).find(
110 |         node => node.name === 'MyComponent' && node.type === 'function'
111 |       );
112 |       expect(functionNode).toBeDefined();
                                 ^
error: expect(received).toBeDefined()

Received: undefined

      at <anonymous> (/home/realme-book/Project/code/scn-ts/repograph/test/unit/scn-ts-integration.test.ts:112:28)
✗ SCN-TS Integration Features (Transaction d669e46a-7204-4171-893f-5ca9b5c2a16d) > Language Support Verification > should handle TSX files and detect JSX elements [42.99ms]
