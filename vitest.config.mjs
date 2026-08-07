import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': __dirname,
      'server-only': path.resolve(__dirname, 'tests/helpers/server-only-stub.js'),
    },
  },
})
