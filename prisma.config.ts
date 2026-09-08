// Prisma configuration. Newer Prisma versions do not auto-load `.env`;
// `import "dotenv/config"` makes DATABASE_URL from `.env` available to the
// Prisma CLI (migrate, db seed, studio).
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
