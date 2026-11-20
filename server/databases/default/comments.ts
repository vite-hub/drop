// The tables of server/comments.ts. ViteHub adds them to the Database at runtime; drizzle-kit reads them here too, so
// `pnpm db:generate` writes their migrations. Nothing at runtime imports this file. The live-site tables that
// 0011_comments_one_model.sql moved from (vitehub_comment_threads_live, vitehub_comments,
// vitehub_comment_scope_counters) stay in the Database as its backup, outside this schema.
//
// Send (`send` in server/comments.ts) adds its sends and setup codes, and the Webhooks tables it delivers through: the
// deliveries, and each member's endpoint.
import { commentSendsSchema, commentsSchema } from "vite-hub/comments/database"
import { webhookEndpointsSchema, webhooksSchema } from "vite-hub/webhooks/database"

export const { vitehubCommentThreads, vitehubCommentMessages, vitehubCommentCounters, vitehubCommentForge } =
  commentsSchema
export const { commentSends, commentSendCodes } = commentSendsSchema
export const { webhookDeliveries } = webhooksSchema
export const { webhookEndpoints } = webhookEndpointsSchema
