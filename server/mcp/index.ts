import { createMcpHandler, createMcpOAuth, type McpHandler, type McpOAuth } from "nitro-mcp-toolkit"
import { useLogger } from "evlog/nitro/v3"
import type { H3Event } from "h3"
import * as v from "valibot"
import { MCP_INSTRUCTIONS, MCP_SERVER_INFO } from "#shared/mcp"
import { identify } from "../utils/identity"
import { requestLog } from "../utils/logs"
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

type McpAuthResult = "challenge" | "rejected" | "ok"

const RpcCalls = v.union([
  v.looseObject({ method: v.string() }),
  v.array(v.looseObject({ method: v.optional(v.string()) })),
])
const CHEAP_BODY_BYTES = 16_384

async function smallBody(request: Request): Promise<string | undefined> {
  if (Number(request.headers.get("content-length")) > CHEAP_BODY_BYTES) return
  const reader = request.clone().body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let text = ""
  let size = 0
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    size += chunk.value.byteLength
    if (size > CHEAP_BODY_BYTES) {
      void reader.cancel().catch(() => {})
      return
    }
    text += decoder.decode(chunk.value, { stream: true })
  }
  return text + decoder.decode()
}

async function rpcMethod(event: H3Event): Promise<string | undefined> {
  const named = event.req.headers.get("mcp-method")
  if (named) return named
  if (event.req.method !== "POST") return
  const text = await smallBody(event.req).catch(() => undefined)
  if (!text) return
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return
  }
  const body = v.safeParse(RpcCalls, json)
  if (!body.success) return
  if (!Array.isArray(body.output)) return body.output.method
  const methods = new Set(body.output.flatMap((call) => (call.method ? [call.method] : [])))
  return methods.size ? [...methods].join(",") : undefined
}

export async function logMcpRequest(event: H3Event) {
  const presented = /^bearer\s+\S/i.test(event.req.headers.get("authorization")?.trim() ?? "")
  const result: McpAuthResult = presented ? "rejected" : "challenge"
  requestLog(event)?.set({
    mcp: {
      method: await rpcMethod(event),
      name: event.req.headers.get("mcp-name") ?? undefined,
      auth: { presented, result },
    },
  })
}

export function mcpFor(origin: string) {
  let server = servers.get(origin)
  if (server) return server
  const oauth = createMcpOAuth({
    resource: `${origin}/mcp`,
    authorizationServers: [`${origin}/api/auth`],
    scopesSupported: ["openid", "profile", "email", "offline_access"],
    verify: async (_token, event) => {
      const who = await identify(event)
      if (who) requestLog(event)?.set({ mcp: { auth: { result: "ok" satisfies McpAuthResult } } })
      return Boolean(who)
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
        const logged = log.getContext().mcp
        const method =
          logged && typeof logged === "object" && "method" in logged && typeof logged.method === "string"
            ? logged.method
            : "tools/call"
        log.set({ mcp: { method, tool: name, isError: failed, calls: [call] } })
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
