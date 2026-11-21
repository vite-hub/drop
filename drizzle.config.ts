import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  out: "./server/databases/default/migrations",
  schema: ["./server/databases/default/index.ts", "./server/databases/default/comments.ts"],
})
