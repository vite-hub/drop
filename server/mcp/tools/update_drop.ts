import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { HTTPError } from "h3"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { LIFETIMES, MAX_KEEP_REASON } from "#shared/expiry"
import { MAX_SLUG, slugify } from "#shared/links"
import { resolveComments } from "../../utils/comments"
import { findDropByRef, permissions, toSummary } from "../../utils/drops"
import { type DropChange, shareChange, updateDrop } from "../../utils/drop-update"
import { requireIdentity } from "../../utils/identity"
import { dropLine, mcpDrop } from "../format"

export default defineMcpTool({
  name: "update_drop",
  title: "Update a drop",
  description: "Change who can open a drop, its title, its link's slug, or its lifetime; renew its window; move it to the Trash (restorable for 15 days) or restore it; resolve a site's review comments once the site is fixed. Only people delete drops for good.",
  annotations: { idempotentHint: true },
  inputSchema: toStandardJsonSchema(v.object({
    id: v.pipe(v.string(), v.description("Drop id, or its link.")),
    share: v.optional(v.pipe(v.picklist(["private", "view", "comment", "edit"]), v.description("private, or what people it's shared with can do: view, comment, or edit (signed-in people only)."))),
    audience: v.optional(v.pipe(v.picklist(["team", "link"]), v.description("Who the share reaches: team (everyone signed in to this Drop, who find it under Shared with me) or link (anyone with the link, no sign-in). Defaults to the drop's current audience, or link."))),
    title: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(160))),
    slug: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_SLUG), v.description("The readable part of the link, like hipoteca-madrid: lowercase words and dashes. Old links keep working."))),
    lifetime: v.optional(v.pipe(v.picklist(LIFETIMES), v.description("temporary (14 days after the last visit), review (30 days), or keep (never expires; needs keepReason). Starts a fresh window."))),
    keepReason: v.optional(v.pipe(v.string(), v.maxLength(MAX_KEEP_REASON), v.description("Why it should be kept, in a sentence or two."))),
    renew: v.optional(v.pipe(v.boolean(), v.description("Start a fresh window without changing the lifetime."))),
    trash: v.optional(v.pipe(v.boolean(), v.description("true moves it to the Trash, false restores it (also after it expired). Trash only what the user asked to remove or what you made and no longer need."))),
    resolves: v.optional(v.pipe(v.array(v.pipe(v.number(), v.integer())), v.maxLength(90), v.description("Numbers of open comments you addressed, from read_drop. For sites, which have no versions; docs and apps resolve when you publish the next version."))),
  })),
  handler: async ({ id, share, audience, renew, trash, resolves, ...rest }, event) => {
    const who = await requireIdentity(event)
    if (rest.slug !== undefined && !slugify(rest.slug)) throw new HTTPError({ status: 400, message: "Use letters or numbers in the slug." })
    const drop = await findDropByRef(id, event)
    if (!drop) throw new HTTPError({ status: 404, message: `No drop with id ${id}.` })
    const change: DropChange = { ...rest, ...(share ? shareChange(share, audience, drop.visibility) : audience ? shareChange(drop.visibility === "private" ? "comment" : drop.access, audience) : {}), ...(renew ? { renew: true } : {}), ...(trash !== undefined ? { trashed: trash } : {}) }
    if (!Object.keys(change).length && !resolves?.length) throw new HTTPError({ status: 400, message: "Nothing to change." })
    if (resolves?.length && (drop.parentId || !permissions(drop, who).manage)) throw new HTTPError({ status: 404, message: `No drop with id ${id}.` })
    const updated = mcpDrop(Object.keys(change).length ? await updateDrop(drop, who, change, event) : toSummary(drop), event.url.origin, drop)
    const resolved = resolves?.length ? await resolveComments(drop, resolves) : []
    const result = { ...updated, ...(resolved.length ? { resolved } : {}) }
    return { content: [{ type: "text" as const, text: `Updated${resolved.length ? `, resolved ${resolved.map(n => `#${n}`).join(", ")}` : ""}:\n${dropLine(updated)}` }], structuredContent: result }
  },
})
