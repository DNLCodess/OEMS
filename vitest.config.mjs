import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    // Without this, running tests from the repo root while a git worktree
    // exists under .worktrees/ (used for isolated feature branches)
    // double-counts every test — vitest's default excludes don't cover it.
    exclude: ['**/node_modules/**', '**/.worktrees/**', '**/.next/**'],
  },
  resolve: {
    alias: {
      '@': __dirname,
      'server-only': path.resolve(__dirname, 'tests/helpers/server-only-stub.js'),
    },
  },
})
