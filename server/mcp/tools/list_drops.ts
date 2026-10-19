import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { HTTPError } from "h3"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { MIB } from "#shared/quotas"
import { findDropByRef, listDrops, listFolder, listSharedWithMe, permissions } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"
import { getUsage } from "../../utils/quotas"
import { dropLine, mcpDrop } from "../format"

export default defineMcpTool({
  name: "list_drops",
  title: "List drops",
  description: "Your drops, newest first, with who can open each, its lifetime, and its link: the ones at the top (folders hold the rest), or with query the matches in any folder. With folder, the drops in that folder, or with query the matches anywhere inside it. Also the ones in your Trash, or other people's drops shared with you, and your plan usage.",
  annotations: { readOnlyHint: true },
  inputSchema: toStandardJsonSchema(v.object({
    query: v.optional(v.pipe(v.string(), v.description("Words to find in the title, file name, slug, or a doc's text."))),
    folder: v.optional(v.pipe(v.string(), v.description("Id or link of a folder: list or search only what's inside it, subfolders included."))),
    kind: v.optional(v.picklist(["markdown", "html", "image", "file", "app", "folder", "site"])),
    shared: v.optional(v.pipe(v.boolean(), v.description("true for shared drops only, false for private ones only."))),
    trash: v.optional(v.pipe(v.boolean(), v.description("List the Trash instead."))),
    sharedWithMe: v.optional(v.pipe(v.boolean(), v.description("List what others share instead: on a team Drop the team's folders and teammates' drops, on a personal one the public links the user opened."))),
    limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
  })),
  handler: async ({ query, folder, kind, shared, trash, sharedWithMe, limit }, event) => {
    const who = await requireIdentity(event)
    const words = query?.toLowerCase().split(/\s+/).filter(Boolean) ?? []
    const inside = folder ? await findDropByRef(folder, event) : null
    if (folder && (!inside || inside.kind !== "folder" || !permissions(inside, who).view)) throw new HTTPError({ status: 404, message: `No folder with id ${folder}.` })
    const list = inside ? listFolder(inside, event, { query, who }) : sharedWithMe ? listSharedWithMe(who, event) : listDrops(who, event, { trash, query: trash ? undefined : query })
    const [all, usage] = await Promise.all([list, getUsage(who.userId)])
    const matched = all.filter(drop => (!kind || drop.kind === kind)
      && (shared === undefined || (drop.share !== "private") === shared)
      // Your drops and a folder's searched on the server, text included; the Trash and Shared with me filter here.
      && (inside || !(trash || sharedWithMe) || words.every(word => `${drop.title} ${drop.filename} ${drop.slug}`.toLowerCase().includes(word))))
    const drops = matched.slice(0, limit).map(drop => mcpDrop(drop, event.url.origin))
    const quota = (name: string, used: number, max: number | null, unit = (n: number) => String(n)) => `${name} ${unit(used)}${max === null ? "" : `/${unit(max)}`}`
    const mib = (n: number) => `${Math.ceil(n / MIB * 10) / 10} MiB`
    const usageLine = usage.enabled ? `Plan ${usage.plan}: ${quota("drops", usage.drops.used, usage.drops.limit)}, ${quota("storage", usage.bytes.used, usage.bytes.limit, mib)}, ${quota("writes this month", usage.writes.used, usage.writes.limit)}.` : "No plan limits."
    const text = `${drops.map(dropLine).join("\n") || (inside ? `Nothing in ${inside.title}${words.length ? " matches" : ""}.` : trash ? "The Trash is empty." : sharedWithMe ? "Nothing is shared with you yet." : "No drops.")}${matched.length > drops.length ? `\n…and ${matched.length - drops.length} more.` : ""}\n${usageLine}`
    return { content: [{ type: "text" as const, text }], structuredContent: { drops, total: matched.length, usage } }
  },
})
