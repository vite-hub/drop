// The tables of server/comments.ts. ViteHub adds them to the Database at runtime; drizzle-kit reads them here too, so
// `pnpm db:generate` writes their migrations and never drops them. Nothing at runtime imports this file.
import { commentsSchema } from "vite-hub/comments/database"

export const { vitehubCommentThreads, vitehubComments } = commentsSchema
