// Vitest stand-in for the `server-only` package.
// Next.js aliases `server-only` at webpack-bundle time to enforce
// server/client boundaries; Vitest has no equivalent, so this no-op
// keeps `import 'server-only'` (used by lib/dal.js) harmless under tests.
export {}
