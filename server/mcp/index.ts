import { createMcpHandler, createMcpOAuth, type McpHandler, type McpOAuth } from "nitro-mcp-toolkit"
import { useLogger } from "evlog/nitro/v3"
import * as v from "valibot"
import { MCP_INSTRUCTIONS, MCP_SERVER_INFO } from "#shared/mcp"
import { identify } from "../utils/identity"
import { mcpSkills, skillResources } from "../utils/mcp-skills"
import addressFeedback from "./prompts/address_feedback"
import acceptSuggestion from "./tools/accept_suggestion"
import createCodeImage from "./tools/create_code_image"
import createFolder from "./tools/create_folder"
import editBoard from "./tools/edit_board"
import listDrops from "./tools/list_drops"
import listHandoffs from "./tools/list_handoffs"
import listFolders from "./tools/list_folders"
import publish from "./tools/publish"
import readDrop from "./tools/read_drop"
import readFile from "./tools/read_file"
import reply from "./tools/reply"
import updateDrop from "./tools/update_drop"
import viewBoard from "./tools/view_board"
import { siteCommentTools } from "./site-comments"

const servers = new Map<string, { mcp: McpHandler; oauth: McpOAuth }>()

const NamesDrop = v.object({ id: v.string() })

export function mcpFor(origin: string) {
  let server = servers.get(origin)
  if (server) return server
  const oauth = createMcpOAuth({
    resource: `${origin}/mcp`,
    authorizationServers: [`${origin}/api/auth`],
    scopesSupported: ["openid", "profile", "email", "offline_access"],
    verify: async (_token, event) => {
      const method = event.req.headers.get("mcp-method")
      if (method) useLogger(event).set({ mcp: { method, name: event.req.headers.get("mcp-name") ?? undefined } })
      return Boolean(await identify(event))
    },
  })
  const mcp = createMcpHandler(
    {
      ...MCP_SERVER_INFO,
      description:
        "Agents publish plans, docs, screenshots, and small apps for review, read the comments, and publish the next version.",
      websiteUrl: origin,
      icons: [
        { src: `${origin}/favicon.svg`, mimeType: "image/svg+xml", sizes: ["any"] },
        { src: `${origin}/icon.png`, mimeType: "image/png", sizes: ["512x512"] },
      ],
      instructions: MCP_INSTRUCTIONS,
      origin: false,
      auth: oauth.auth,
      tools: [
        publish,
        readDrop,
        readFile,
        reply,
        acceptSuggestion,
        listDrops,
        listHandoffs,
        listFolders,
        updateDrop,
        createFolder,
        createCodeImage,
        editBoard,
        viewBoard,
        ...siteCommentTools,
      ],
      prompts: [addressFeedback],
      resources: skillResources,
      onToolCall: ({ name, result, durationMs, event }) => {
        const log = useLogger(event)
        const failed = "isError" in result && Boolean(result.isError)
        const error = failed
          ? result.content
              ?.map((block) => ("text" in block ? block.text : ""))
              .join(" ")
              .slice(0, 500)
          : undefined
        const named = v.safeParse(NamesDrop, "structuredContent" in result ? result.structuredContent : undefined)
        const drop = named.success ? named.output.id : event.context.loggedDrop
        event.context.loggedDrop = undefined
        const call = { tool: name, durationMs: Math.round(durationMs), isError: failed, drop, error }
        log.set({ mcp: { method: "tools/call", tool: name, isError: failed, calls: [call] } })
        if (failed) log.warn(`MCP tool ${name} failed`)
      },
    },
    { extensionPlugins: [mcpSkills()] },
  )
  server = { mcp, oauth }
  if (servers.size >= 8) servers.delete(servers.keys().next().value!)
  servers.set(origin, server)
  return server
}
