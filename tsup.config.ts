import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/pipeline/analyzer.worker.ts'],
    format: ['esm'],
    target: 'es2022',
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: true,
    treeshake: true,
    minify: false,
    outDir: 'dist',
  onSuccess: async () => {
    // Copy WASM files to dist folder
    const wasmDir = join('dist', 'wasm');
    if (!existsSync(wasmDir)) {
      mkdirSync(wasmDir, { recursive: true });
    }

    const wasmFiles = [
      'tree-sitter-typescript/tree-sitter-typescript.wasm',
      'tree-sitter-typescript/tree-sitter-tsx.wasm',
      'tree-sitter-javascript/tree-sitter-javascript.wasm',
      'tree-sitter-python/tree-sitter-python.wasm',
      'tree-sitter-java/tree-sitter-java.wasm',
      'tree-sitter-c/tree-sitter-c.wasm',
      'tree-sitter-cpp/tree-sitter-cpp.wasm',
      'tree-sitter-c-sharp/tree-sitter-c-sharp.wasm',
      'tree-sitter-css/tree-sitter-css.wasm',
      'tree-sitter-go/tree-sitter-go.wasm',
      'tree-sitter-php/tree-sitter-php.wasm',
      'tree-sitter-ruby/tree-sitter-ruby.wasm',
      'tree-sitter-rust/tree-sitter-rust.wasm',
      'tree-sitter-solidity/tree-sitter-solidity.wasm',
      'tree-sitter-swift/tree-sitter-swift.wasm',
      'tree-sitter-vue/tree-sitter-vue.wasm',
    ];

    for (const wasmFile of wasmFiles) {
      const srcPath = join('node_modules', wasmFile);
      const destPath = join('dist', 'wasm', wasmFile.split('/')[1]);
      
      if (existsSync(srcPath)) {
        copyFileSync(srcPath, destPath);
        console.log(`Copied ${wasmFile} to dist/wasm/`);
      }
    }
  },
  },
  {
    entry: ['src/index.browser.ts'],
    format: ['esm'],
    target: 'es2022',
    dts: true,
    sourcemap: true,
    splitting: true,
    treeshake: true,
    minify: false,
    outDir: 'dist',
    outExtension: () => ({ js: '.browser.js' }),
    platform: 'browser',
    external: ['fs', 'path', 'process', 'node:*', 'bun:*'],
  }
]);