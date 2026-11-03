// The tables of server/comments.ts. ViteHub adds them to the Database at runtime; drizzle-kit reads them here too, so
// `pnpm db:generate` writes their migrations. Nothing at runtime imports this file. The live-site tables that
// 0010_comments_one_model.sql moved from (vitehub_comment_threads_live, vitehub_comments,
// vitehub_comment_scope_counters) stay in the Database as its backup, outside this schema.
import { commentsSchema } from "vite-hub/comments/database"

export const { vitehubCommentThreads, vitehubCommentMessages, vitehubCommentCounters, vitehubCommentForge } =
  commentsSchema
