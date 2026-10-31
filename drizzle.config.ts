import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  out: "./server/databases/migrations",
  // ./comments.ts holds the tables that ViteHub Comments adds to the Database at runtime.
  schema: ["./server/databases/config.ts", "./server/databases/comments.ts"],
})
