import { defineHandler } from "h3"
import { mcpFor } from "../mcp"
import { bearerFrom } from "../utils/identity"

export default defineHandler((event) => {
  if (!bearerFrom(event.req.headers)) return mcpFor(event.url.origin).mcp(event)
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    statusText: "Method not allowed",
    headers: { allow: "POST", "content-type": "application/json" },
  })
})
