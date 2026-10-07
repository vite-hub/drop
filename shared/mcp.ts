// Drop's MCP server identity, shared by the endpoint (server/mcp) and the docs.
export const MCP_LATEST = "2026-07-28"
export const MCP_LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26"]
export const MCP_SERVER_INFO = { name: "drop", title: "Drop", version: "0.1.0" }
export const MCP_INSTRUCTIONS = "Drop stores docs and small static apps for review. Everything starts private. Read open comments with list_comments, then drop the next version with create_doc (supersedes) or publish_app (id). Turn code into an image with create_code_image. The vitehub-drop skill (skills/list) explains the workflow and how to write documents."
