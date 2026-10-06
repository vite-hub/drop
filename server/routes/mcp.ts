import { defineHandler, HTTPError } from "h3"
import { MCP_INSTRUCTIONS, MCP_LATEST, MCP_LEGACY, MCP_SERVER_INFO, MCP_TOOLS } from "#shared/mcp"
import { listComments } from "../utils/comments"
import { createDocDrop, dropDetail, dropPageUrl, findDrop, listDrops, permissions, publishApp } from "../utils/drops"
import { identify } from "../utils/identity"

type Message = { jsonrpc?: string; id?: string | number | null; method?: unknown; params?: Record<string, unknown> }

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })

/**
 * MCP over Streamable HTTP, without an SDK. Speaks the stateless 2026-07-28 revision (`server/discover`) and
 * answers older clients' `initialize`. Auth: a Drop API key as `Authorization: Bearer drop_…`. JSON only, no SSE.
 */
export default defineHandler(async (event) => {
  if (event.req.method === "GET" || event.req.method === "DELETE")
    return new Response("Drop MCP: POST JSON-RPC to this URL. Streams are not supported.", { status: 405, headers: { allow: "POST" } })
  if (event.req.method !== "POST") throw new HTTPError({ status: 405, statusText: "Method not allowed" })

  const reply = (id: Message["id"], result: unknown) => json({ jsonrpc: "2.0", id, result })
  const fail = (id: Message["id"], code: number, message: string, status = 200) => json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status)

  let message: Message
  try {
    message = await event.req.json() as Message
  }
  catch {
    return fail(null, -32700, "Parse error", 400)
  }
  if (!message || typeof message.method !== "string") return fail(message?.id, -32600, "Invalid request", 400)
  if (message.id === undefined) return new Response(null, { status: 202 })

  const who = await identify(event)
  if (!who) {
    return json(
      { jsonrpc: "2.0", id: message.id, error: { code: -32001, message: "Missing or invalid Drop API key. Create one at /agents and send it as Authorization: Bearer <key>." } },
      401,
      { "www-authenticate": 'Bearer realm="drop"' },
    )
  }
  const origin = event.url.origin
  const params = message.params ?? {}

  switch (message.method) {
    case "initialize": {
      const asked = String(params.protocolVersion ?? "")
      return reply(message.id, { protocolVersion: MCP_LEGACY.includes(asked) ? asked : MCP_LEGACY[0], capabilities: { tools: {} }, serverInfo: MCP_SERVER_INFO, instructions: MCP_INSTRUCTIONS })
    }
    case "server/discover":
      return reply(message.id, { resultType: "complete", supportedVersions: [MCP_LATEST, ...MCP_LEGACY], capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS, _meta: { "io.modelcontextprotocol/serverInfo": MCP_SERVER_INFO }, ttlMs: 3_600_000, cacheScope: "public" })
    case "ping":
      return reply(message.id, { resultType: "complete" })
    case "tools/list":
      return reply(message.id, { resultType: "complete", tools: MCP_TOOLS, ttlMs: 300_000, cacheScope: "public" })
    case "tools/call": {
      const name = String(params.name ?? "")
      const args = (params.arguments ?? {}) as Record<string, unknown>
      const done = (text: string, isError = false) => reply(message.id, { resultType: "complete", content: [{ type: "text", text }], isError })
      try {
        if (name === "list_drops") {
          const drops = await listDrops(who)
          return done(drops.map(drop => `- ${drop.title} (${drop.kind}, ${drop.visibility}) id=${drop.id} ${dropPageUrl(origin, drop.id)}`).join("\n") || "No drops yet.")
        }
        if (name === "read_drop" || name === "list_comments") {
          const drop = await findDrop(String(args.id ?? ""))
          if (!drop || !permissions(drop, who).view) return done(`No drop with id ${String(args.id)}.`, true)
          if (name === "list_comments") {
            const open = (await listComments(drop.id)).filter(comment => !comment.resolved)
            return done(open.map(comment => `${comment.n}. ${comment.quote ? `> ${comment.quote}\n   ` : ""}${comment.body} (${comment.authorName}${comment.page ? `, ${comment.page}` : ""})`).join("\n") || "No open comments.")
          }
          const detail = await dropDetail(drop, who, origin)
          if (detail.files) return done(Object.entries(detail.files).map(([path, content]) => `--- ${path}\n${content}`).join("\n\n"))
          return done(detail.content ?? `Binary file: ${detail.url}`)
        }
        if (name === "create_doc") {
          const markdown = String(args.markdown ?? "")
          if (!markdown.trim()) return done("markdown is required.", true)
          const drop = await createDocDrop(who, {
            filename: "doc.md",
            bytes: new TextEncoder().encode(markdown),
            title: typeof args.title === "string" ? args.title : undefined,
            supersedes: typeof args.supersedes === "string" ? args.supersedes : undefined,
            visibility: args.shared === true ? "shared" : undefined,
          })
          return done(`Dropped${drop.version > 1 ? ` v${drop.version}` : ""} ${drop.visibility === "shared" ? "and shared" : "privately"}: ${dropPageUrl(origin, drop.id)} (id=${drop.id})`)
        }
        if (name === "publish_app") {
          const app = await publishApp(who, { id: typeof args.id === "string" ? args.id : undefined, name: typeof args.name === "string" ? args.name : undefined, files: (args.files ?? {}) as Record<string, string> })
          return done(`Published v${app.version}: ${dropPageUrl(origin, app.id)} (id=${app.id})`)
        }
      }
      catch (error) {
        return done(error instanceof HTTPError ? error.statusText ?? error.message : "Something went wrong.", true)
      }
      return fail(message.id, -32602, `Unknown tool: ${name}`)
    }
    default:
      return fail(message.id, -32601, `Method not found: ${message.method}`, 404)
  }
})
