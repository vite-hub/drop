import { defineHandler } from "h3"
import { mcpFor } from "../mcp"
import { bearerFrom } from "../utils/identity"

/**
 * GET opens a server-to-client event stream, which Drop doesn't offer, so the answer is 405 whoever asks. Clients send
 * it after every initialize, with their token: answer before checking the token (2-4 D1 calls). Without one, the
 * handler's 401 still names the protected resource metadata, and it reads no database.
 */
export default defineHandler((event) => {
  if (!bearerFrom(event.req.headers)) return mcpFor(event.url.origin).mcp(event)
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    statusText: "Method not allowed",
    headers: { allow: "POST", "content-type": "application/json" },
  })
})
