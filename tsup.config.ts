import { defineConfig } from 'tsup';

export default defineConfig({
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
});