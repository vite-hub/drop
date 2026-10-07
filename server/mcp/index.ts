import { createMcpHandler, createMcpOAuth, type McpHandler, type McpOAuth } from "nitro-mcp-toolkit"
import { useLogger } from "evlog/nitro/v3"
import { MCP_INSTRUCTIONS, MCP_SERVER_INFO } from "#shared/mcp"
import { identify } from "../utils/identity"
import { mcpSkills, skillResources } from "../utils/mcp-skills"
import addressFeedback from "./prompts/address_feedback"
import createCodeImage from "./tools/create_code_image"
import createDoc from "./tools/create_doc"
import listComments from "./tools/list_comments"
import listDrops from "./tools/list_drops"
import publishApp from "./tools/publish_app"
import readDrop from "./tools/read_drop"

/**
 * Drop's MCP server (nitro-mcp-toolkit on h3-mcp): the 2026-07-28 revision plus the 2025 ones, one file per
 * tool and prompt, and the Skills extension. It's an OAuth 2.1 protected resource: a `401` points at
 * `/.well-known/oauth-protected-resource/mcp`, which names Drop's Better Auth as the authorization server, and
 * every bearer token must be a JWT Drop issued for this `/mcp` (checked in `identify`).
 *
 * The resource identifier is the request's origin plus `/mcp`, so the handler is built once per origin.
 */
const servers = new Map<string, { mcp: McpHandler; oauth: McpOAuth }>()

export function mcpFor(origin: string) {
  let server = servers.get(origin)
  if (server) return server
  const oauth = createMcpOAuth({
    resource: `${origin}/mcp`,
    authorizationServers: [`${origin}/api/auth`],
    scopesSupported: ["openid", "profile", "email", "offline_access"],
    verify: async (_token, event) => {
      // Modern clients name the JSON-RPC method in a header; it makes /mcp requests tell apart in the logs.
      const method = event.req.headers.get("mcp-method")
      if (method) useLogger(event).set({ mcp: { method, name: event.req.headers.get("mcp-name") ?? undefined } })
      return Boolean(await identify(event))
    },
  })
  const mcp = createMcpHandler({
    ...MCP_SERVER_INFO,
    description: "Agents drop plans, docs, and small apps for review, read the comments, and publish the next version.",
    websiteUrl: "https://drop.vitehub.dev",
    instructions: MCP_INSTRUCTIONS,
    // MCP clients send no Origin; the access token, not the origin, is the boundary.
    origin: false,
    auth: oauth.auth,
    tools: [listDrops, readDrop, listComments, createDoc, publishApp, createCodeImage],
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
  server = { mcp, oauth }
  servers.set(origin, server)
  return server
}
