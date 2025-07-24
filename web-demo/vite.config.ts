import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
// import wasm from 'vite-plugin-wasm'
// import topLevelAwait from 'vite-plugin-top-level-await'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // wasm(),
    // topLevelAwait()
  ],
  optimizeDeps: {
    exclude: ['repograph', 'web-tree-sitter']
  },
  resolve: {
    alias: {
      'repograph': path.resolve(__dirname, '../dist/browser.js')
    }
  },
  define: {
    global: 'globalThis',
    'process.env': {},
    'process.platform': '"browser"',
    'process.version': '"v18.0.0"'
  },
  server: {
    fs: {
      allow: ['..']
    },
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    }
  },
  worker: {
    plugins: () => [
      // wasm(),
      // topLevelAwait()
    ]
  },
  assetsInclude: ['**/*.wasm'],
  publicDir: 'public'
})
