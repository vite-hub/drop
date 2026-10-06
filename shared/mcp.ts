// Drop's MCP server surface, shared by the server endpoint and the docs.
export const MCP_LATEST = "2026-07-28";
export const MCP_LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const MCP_SERVER_INFO = { name: "drop", title: "Drop", version: "0.1.0" };
export const MCP_INSTRUCTIONS = "Drop stores docs and small static apps for review. Everything starts private. Read open comments with list_comments, then drop the next version with create_doc (supersedes) or publish_app (id).";

export const MCP_TOOLS = [
  {
    name: "list_drops",
    title: "List drops",
    description: "List your drops (docs and apps), newest first, with id, kind, visibility, and link.",
    inputSchema: { type: "object", additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: "read_drop",
    title: "Read a drop",
    description: "Read a doc's Markdown, or every file of an app.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Drop id from list_drops." } }, required: ["id"], additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: "list_comments",
    title: "List open comments",
    description: "Open review comments on a drop: the quoted text, the comment, and who wrote it. Address them in the next version.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: "create_doc",
    title: "Drop a doc",
    description: "Drop a Markdown doc. Private unless shared is true. Pass supersedes to publish it as the next version of an existing doc.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        markdown: { type: "string" },
        shared: { type: "boolean", default: false },
        supersedes: { type: "string", description: "Id of the doc this replaces." }
      },
      required: ["markdown"],
      additionalProperties: false
    }
  },
  {
    name: "publish_app",
    title: "Publish an app",
    description: "Publish a static app as files keyed by path (index.html required). Pass id to publish the next version of an existing app.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        id: { type: "string" },
        files: { type: "object", additionalProperties: { type: "string" }, description: "Path to file contents, e.g. {\"index.html\": \"...\"}." }
      },
      required: ["files"],
      additionalProperties: false
    }
  }
] as const;
