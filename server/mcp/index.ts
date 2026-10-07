import { createMcpHandler } from "nitro-mcp-toolkit"
import { useLogger } from "evlog/nitro/v3"
import { MCP_INSTRUCTIONS, MCP_SERVER_INFO } from "#shared/mcp"
import { identify } from "../utils/identity"
import { mcpSkills, skillResources } from "../utils/mcp-skills"
import addressFeedback from "./prompts/address_feedback"
import createDoc from "./tools/create_doc"
import listComments from "./tools/list_comments"
import listDrops from "./tools/list_drops"
import publishApp from "./tools/publish_app"
import readDrop from "./tools/read_drop"

/**
 * Drop's MCP server (nitro-mcp-toolkit on h3-mcp): the 2026-07-28 revision plus the 2025 ones, one file per
 * tool and prompt, the Skills extension, and Drop's API keys as the credential (`Authorization: Bearer drop_…`
 * or `x-api-key`). Wired by hand rather than through the module because the key check is a function.
 */
export const mcp = createMcpHandler({
  ...MCP_SERVER_INFO,
  description: "Agents drop plans, docs, and small apps for review, read the comments, and publish the next version.",
  websiteUrl: "https://drop.vitehub.dev",
  instructions: MCP_INSTRUCTIONS,
  // MCP clients send no Origin; the API key, not the origin, is the boundary.
  origin: false,
  auth: {
    validate: async (_credentials, event) => {
      // Modern clients name the JSON-RPC method in a header; it makes /mcp requests tell apart in the logs.
      const method = event.req.headers.get("mcp-method")
      if (method) useLogger(event).set({ mcp: { method, name: event.req.headers.get("mcp-name") ?? undefined } })
      return Boolean(await identify(event))
    },
  },
  tools: [listDrops, readDrop, listComments, createDoc, publishApp],
  prompts: [addressFeedback],
  resources: skillResources,
  // Every tool call lands on the request's wide event.
  onToolCall: ({ name, result, durationMs, event }) => {
    const log = useLogger(event)
    const failed = "isError" in result && Boolean(result.isError)
    log.set({ mcp: { tool: name, durationMs: Math.round(durationMs), isError: failed } })
    if (failed) log.warn(`MCP tool ${name} failed`, { mcp: { error: result.content?.map(block => ("text" in block ? block.text : "")).join(" ").slice(0, 500) } })
  },
}, { extensionPlugins: [mcpSkills()] })
