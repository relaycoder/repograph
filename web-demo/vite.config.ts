import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['repograph']
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
    }
  }
})