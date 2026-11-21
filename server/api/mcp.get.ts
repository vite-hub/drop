import { defineHandler } from "h3"
import { mcpFor } from "../mcp"

export default defineHandler((event) =>
  mcpFor(event.url.origin).mcp.definitions.map(({ kind, name, title, description, uri }) => ({
    kind,
    name,
    title,
    description,
    uri,
  })),
)
