import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const resolve = {
  alias: {
    '@': __dirname,
    'server-only': path.resolve(__dirname, 'tests/helpers/server-only-stub.js'),
  },
}

// DB integration tests hit the real SQL Server container and truncate tables
// between tests — they must run serially, never in parallel with each other.
// Pure unit tests stay parallel.
const DB_TESTS = ['lib/db/**/*.test.js', 'prisma/**/*.test.js']

export default defineConfig({
  resolve,
  test: {
    exclude: ['**/node_modules/**', '**/.worktrees/**', '**/.next/**'],
    projects: [
      {
        resolve,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['**/*.test.js'],
          exclude: ['**/node_modules/**', '**/.worktrees/**', '**/.next/**', ...DB_TESTS],
        },
      },
      {
        resolve,
        test: {
          name: 'db',
          environment: 'node',
          include: DB_TESTS,
          fileParallelism: false,
          sequence: { concurrent: false },
        },
      },
    ],
  },
})
