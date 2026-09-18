import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    host: '127.0.0.1',
  },
  preview: {
    port: 4174,
    host: '127.0.0.1',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    css: true,
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', 'tests/e2e/**'],
  },
})
