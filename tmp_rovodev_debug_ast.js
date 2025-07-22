#!/usr/bin/env bun

import Parser from 'web-tree-sitter';

async function debugAST() {
  await Parser.init();
  const parser = new Parser();
  const TypeScript = await Parser.Language.load('node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm');
  parser.setLanguage(TypeScript);

  const code = `export default () => {}`;
  const tree = parser.parse(code);
  
  function printNode(node, depth = 0) {
    const indent = '  '.repeat(depth);
    console.log(`${indent}${node.type} "${node.text}"`);
    for (let i = 0; i < node.childCount; i++) {
      printNode(node.child(i), depth + 1);
    }
  }
  
  console.log('AST for: export default () => {}');
  printNode(tree.rootNode);
}

debugAST().catch(console.error);