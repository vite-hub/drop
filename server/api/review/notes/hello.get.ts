import { defineHandler } from "h3"
import { MCP_SERVER_INFO } from "#shared/mcp"
import { contentOriginPattern } from "../../../utils/content-origin"

export default defineHandler((event) => {
  const content = contentOriginPattern(event)
  return {
    drop: event.url.origin,
    name: MCP_SERVER_INFO.title,
    version: MCP_SERVER_INFO.version,
    ...(content ? { content } : {}),
  }
})
