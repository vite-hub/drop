import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { HTTPError } from "h3"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { LIFETIMES, MAX_KEEP_REASON } from "#shared/expiry"
import { MAX_SLUG, slugify } from "#shared/links"
import { findDropByRef } from "../../utils/drops"
import { type DropChange, shareChange, updateDrop } from "../../utils/drop-update"
import { requireIdentity } from "../../utils/identity"
import { dropLine, mcpDrop } from "../format"

export default defineMcpTool({
  name: "update_drop",
  title: "Update a drop",
  description: "Change who can open a drop, its title, its link's slug, or its lifetime; renew its window; move it into a folder or out of one; move it to the Trash (restorable for 15 days) or restore it. A folder's share, lifetime, and Trash apply to everything in it. Only people delete drops for good.",
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
    folder: v.optional(v.pipe(v.string(), v.description("Id or link of the folder to move it into, or an empty string to move it out to the top. In a folder it shares and lives with the folder."))),
  })),
  handler: async ({ id, share, audience, renew, trash, ...rest }, event) => {
    const who = await requireIdentity(event)
    if (rest.slug !== undefined && !slugify(rest.slug)) throw new HTTPError({ status: 400, message: "Use letters or numbers in the slug." })
    const drop = await findDropByRef(id, event)
    if (!drop) throw new HTTPError({ status: 404, message: `No drop with id ${id}.` })
    // The drop's own share, not the one a folder gives it: that's the one this changes.
    const own = drop.raw ?? drop
    const change: DropChange = { ...rest, ...(share ? shareChange(share, audience, own.visibility) : audience ? shareChange(own.visibility === "private" ? "comment" : own.access, audience) : {}), ...(renew ? { renew: true } : {}), ...(trash !== undefined ? { trashed: trash } : {}) }
    if (!Object.keys(change).length) throw new HTTPError({ status: 400, message: "Nothing to change." })
    const updated = mcpDrop(await updateDrop(drop, who, change, event), event.url.origin, drop)
    return { content: [{ type: "text" as const, text: `Updated:\n${dropLine(updated)}` }], structuredContent: updated }
  },
})
