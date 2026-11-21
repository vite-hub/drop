import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { dropPageUrl } from "../../utils/drops"
import { listHandoffs } from "../../utils/handoffs"
import { requireIdentity } from "../../utils/identity"

export default defineMcpTool({
  name: "list_handoffs",
  title: "List handoffs",
  description:
    "The user's handoffs: the comments they sent to their agent with Send in Drop's review pill, newest first. Each names its drop and how many threads it carries, the user's own (asks) and others' (quotes). `sent` ones wait for an agent; `working` ones an agent already opened. Open one with read_drop and its handoff id, which reads those threads and tells the user you are working on it; then answer each ask in its thread, or publish the next version with base.",
  annotations: { readOnlyHint: true },
  inputSchema: toStandardJsonSchema(v.object({})),
  handler: async (_input, event) => {
    event.res.headers.set("Cache-Control", "private, no-store")
    const who = await requireIdentity(event)
    const handoffs = (await listHandoffs(who)).map((handoff) => ({
      id: handoff.id,
      state: handoff.state,
      drop: { id: handoff.drop.id, title: handoff.drop.title, url: dropPageUrl(event.url.origin, handoff.drop) },
      asks: handoff.threads.filter((thread) => thread.role === "ask").length,
      quotes: handoff.threads.filter((thread) => thread.role === "quote").length,
      sentAt: new Date(handoff.createdAt).toISOString(),
    }))
    const line = (handoff: (typeof handoffs)[number]) =>
      `- ${handoff.id} (${handoff.state}, ${handoff.sentAt}): ${handoff.asks} ${handoff.asks === 1 ? "ask" : "asks"}, ${handoff.quotes} ${handoff.quotes === 1 ? "quote" : "quotes"} on "${handoff.drop.title}" ${handoff.drop.url}`
    const text = handoffs.length
      ? `${handoffs.map(line).join("\n")}\n\nOpen one with read_drop and handoff set to its id.`
      : "No handoffs wait. The user sends comments to you with Send in a drop's review pill."
    return { content: [{ type: "text" as const, text }], structuredContent: { handoffs } }
  },
})
