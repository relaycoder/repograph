ParserError: [java] Failed to process java files
   language: "java",

      at new RepoGraphError (/home/realme-book/Project/code/repograph/src/utils/error.util.ts:3:5)

QueryError: Bad node name 'modifier'
   kind: 2,
   info: {
  word: "modifier",
},
  index: 233,
 length: 8,

      at new QueryError (/home/realme-book/Project/code/repograph/node_modules/web-tree-sitter/tree-sitter.js:1207:5)

73 |   it.each(testCases)('should correctly analyze $language', async ({ files, expectedNodeIds, expectedEdges }) => {
74 |     const graph = await runAnalyzerForTests(files);
75 |
76 |     // Verify all expected nodes exist
77 |     for (const nodeId of expectedNodeIds) {
78 |       expect(graph.nodes.has(nodeId)).toBe(true);
                                           ^
error: expect(received).toBe(expected)

Expected: true
Received: false

      at <anonymous> (/home/realme-book/Project/code/repograph/test/integration/multi-language.test.ts:78:39)
✗ Multi-Language Support > should correctly analyze $language [7.00ms]
