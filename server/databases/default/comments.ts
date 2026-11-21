import { commentSendsSchema, commentsSchema } from "vite-hub/comments/database"
import { webhookEndpointsSchema, webhooksSchema } from "vite-hub/webhooks/database"

export const { vitehubCommentThreads, vitehubCommentMessages, vitehubCommentCounters, vitehubCommentForge } =
  commentsSchema
export const { commentSends } = commentSendsSchema
export const { webhookDeliveries } = webhooksSchema
export const { webhookEndpoints, webhookPairings } = webhookEndpointsSchema
