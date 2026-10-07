import { defineConfig } from "drizzle-kit"

// `pnpm db:migrate:libsql` applies server/databases/migrations to a libSQL database: Turso on Vercel, Netlify,
// and Deno Deploy (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN), or the SQLite file on a VPS. D1 uses `pnpm db:migrate:remote`.
export default defineConfig({
  dialect: "turso",
  out: "./server/databases/migrations",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:.data/drop.sqlite",
    authToken: process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN,
  },
})
