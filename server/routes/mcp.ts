import { defineHandler } from "h3"
import { logMcpRequest, mcpFor } from "../mcp"
import { bearerFrom } from "../utils/identity"

export default defineHandler(async (event) => {
  await logMcpRequest(event)
  if (!bearerFrom(event.req.headers)) await event.req.body?.cancel().catch(() => {})
  return mcpFor(event.url.origin).mcp(event)
})
