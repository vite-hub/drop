import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { MIB } from "#shared/quotas"
import { listDrops, listSharedWithMe } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"
import { getUsage } from "../../utils/quotas"
import { dropLine, mcpDrop } from "../format"

export default defineMcpTool({
  name: "list_drops",
  title: "List drops",
  description: "Your drops, newest first, with who can open each, its lifetime, and its link; the ones in your Trash; or other people's drops shared with you. Also returns your plan usage.",
  annotations: { readOnlyHint: true },
  inputSchema: toStandardJsonSchema(v.object({
    query: v.optional(v.pipe(v.string(), v.description("Words to find in the title or file name."))),
    kind: v.optional(v.picklist(["markdown", "html", "image", "file", "app", "site"])),
    shared: v.optional(v.pipe(v.boolean(), v.description("true for shared drops only, false for private ones only."))),
    trash: v.optional(v.pipe(v.boolean(), v.description("List the Trash instead."))),
    sharedWithMe: v.optional(v.pipe(v.boolean(), v.description("List other people's drops instead: everything shared with the team, and links the user opened."))),
    limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
  })),
  handler: async ({ query, kind, shared, trash, sharedWithMe, limit }, event) => {
    const who = await requireIdentity(event)
    const words = query?.toLowerCase().split(/\s+/).filter(Boolean) ?? []
    const [all, usage] = await Promise.all([sharedWithMe ? listSharedWithMe(who, event) : listDrops(who, event, { trash }), getUsage(who.userId)])
    const matched = all.filter(drop => (!kind || drop.kind === kind)
      && (shared === undefined || (drop.visibility !== "private") === shared)
      && words.every(word => `${drop.title} ${drop.filename}`.toLowerCase().includes(word)))
    const drops = matched.slice(0, limit).map(drop => mcpDrop(drop, event.url.origin))
    const quota = (name: string, used: number, max: number | null, unit = (n: number) => String(n)) => `${name} ${unit(used)}${max === null ? "" : `/${unit(max)}`}`
    const mib = (n: number) => `${Math.ceil(n / MIB * 10) / 10} MiB`
    const usageLine = usage.enabled ? `Plan ${usage.plan}: ${quota("drops", usage.drops.used, usage.drops.limit)}, ${quota("storage", usage.bytes.used, usage.bytes.limit, mib)}, ${quota("writes this month", usage.writes.used, usage.writes.limit)}.` : "No plan limits."
    const text = `${drops.map(dropLine).join("\n") || (trash ? "The Trash is empty." : sharedWithMe ? "Nothing is shared with you yet." : "No drops.")}${matched.length > drops.length ? `\n…and ${matched.length - drops.length} more.` : ""}\n${usageLine}`
    return { content: [{ type: "text" as const, text }], structuredContent: { drops, total: matched.length, usage } }
  },
})
