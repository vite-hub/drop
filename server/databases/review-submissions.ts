import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { commentsSchema } from "vite-hub/comments/database"

/** The thread claimed by a review submission. The insert trigger claims it in the Comments write transaction. */
export const reviewSubmissions = sqliteTable(
  "review_submissions",
  {
    scope: text("scope").notNull(),
    requestId: text("request_id").notNull(),
    threadId: text("thread_id")
      .notNull()
      .references(() => commentsSchema.vitehubCommentThreads.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.requestId] }),
    index("review_submissions_thread_idx").on(table.threadId),
  ],
)
