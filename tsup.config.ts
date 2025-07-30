import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// A helper to get a list of wasm files from repograph-core's LANGUAGE_CONFIGS
// In a real monorepo, you might import this directly. Here, we'll hardcode it.
const getWasmFiles = () => [
  'tree-sitter-typescript/tree-sitter-typescript.wasm',
  'tree-sitter-typescript/tree-sitter-tsx.wasm',
  'tree-sitter-python/tree-sitter-python.wasm',
  'tree-sitter-java/tree-sitter-java.wasm',
  'tree-sitter-c/tree-sitter-c.wasm',
  'tree-sitter-cpp/tree-sitter-cpp.wasm',
  'tree-sitter-c-sharp/tree-sitter-c_sharp.wasm',
  'tree-sitter-css/tree-sitter-css.wasm',
  'tree-sitter-go/tree-sitter-go.wasm',
  'tree-sitter-php/tree-sitter-php.wasm',
  'tree-sitter-ruby/tree-sitter-ruby.wasm',
  'tree-sitter-rust/tree-sitter-rust.wasm',
  'tree-sitter-solidity/tree-sitter-solidity.wasm',
  'tree-sitter-swift/tree-sitter-swift.wasm',
  'tree-sitter-vue/tree-sitter-vue.wasm',
];


export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'analyzer.worker': 'src/pipeline/analyzer.worker.ts',
  },
  format: ['esm', 'cjs'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  outDir: 'dist',
  onSuccess: async () => {
    console.log('Build successful. Copying WASM files...');
    const wasmDir = join('dist', 'wasm');
    if (!existsSync(wasmDir)) {
      mkdirSync(wasmDir, { recursive: true });
    }

    for (const wasmFile of getWasmFiles()) {
      try {
        const [pkgName, ...rest] = wasmFile.split('/');
        if (!pkgName || rest.length === 0) {
          console.warn(`[WARN] Skipping invalid wasmFile path: ${wasmFile}`);
          continue;
        }
        const wasmPathInPkg = rest.join('/');
        // Use import.meta.resolve to robustly find the package path
        const pkgJsonUrl = await import.meta.resolve(`${pkgName}/package.json`);
        const pkgDir = dirname(fileURLToPath(pkgJsonUrl));
        const srcPath = join(pkgDir, wasmPathInPkg);
        const destPath = join(wasmDir, wasmFile.split('/').pop()!);

        if (existsSync(srcPath)) {
          copyFileSync(srcPath, destPath);
          console.log(`Copied ${wasmFile.split('/').pop()} to dist/wasm/`);
        } else {
          console.warn(`[WARN] Could not find WASM file at ${srcPath}`);
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('ERR_MODULE_NOT_FOUND')) {
          console.warn(`[WARN] Could not resolve package for ${wasmFile}. Is its package installed?`);
        } else {
          console.warn(`[WARN] Error processing ${wasmFile}:`, e);
        }
      }
    }
    console.log('WASM copy complete.');
  },
});
