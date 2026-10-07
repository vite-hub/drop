import { defineHandler } from "h3"
import { mcpFor } from "../mcp"

/** What the MCP server serves, for the Docs page: the same catalog clients see in tools/list. */
export default defineHandler(event => mcpFor(event.url.origin).mcp.definitions.map(({ kind, name, title, description, uri }) => ({ kind, name, title, description, uri })))
