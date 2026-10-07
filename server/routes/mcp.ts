import { defineHandler } from "h3"
import { mcpFor } from "../mcp"
import { bearerFrom } from "../utils/identity"

export default defineHandler(async (event) => {
  // Without a token the answer is a 401 that never reads the body. Release it first, as /api/files does:
  // wrangler's dev proxy drops the connection when a request body is left unread.
  if (!bearerFrom(event.req.headers)) await event.req.body?.cancel().catch(() => {})
  return mcpFor(event.url.origin).mcp(event)
})
