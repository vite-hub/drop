import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  out: "./server/databases/default/migrations",
  // ./comments.ts holds the tables that ViteHub Comments adds to the Database at runtime.
  schema: ["./server/databases/default/index.ts", "./server/databases/default/comments.ts"],
})
