import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { HTTPError } from "h3"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { inArray } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import { drops } from "../../databases/config"
import { dropPageUrl, findDrop, permissions, versionChain } from "../../utils/drops"
import { expiryPolicy, renewDrop } from "../../utils/expiry"
import { requireIdentity } from "../../utils/identity"

export default defineMcpTool({
  name: "keep_drop",
  title: "Keep a drop",
  description: "Drops expire after a stretch with no visits. Renew one for a fresh window (this also restores a recently expired drop), or ask its owner to keep it forever: only a person can approve that, on the drop's page.",
  inputSchema: toStandardJsonSchema(v.object({
    id: v.pipe(v.string(), v.description("Drop id from list_drops.")),
    forever: v.optional(v.pipe(v.boolean(), v.description("Ask the owner to keep this drop forever instead of renewing it.")), false),
  })),
  handler: async ({ id, forever }, event) => {
    const who = await requireIdentity(event)
    const drop = await findDrop(id, event)
    if (!drop || !permissions(drop, who).manage) throw new HTTPError({ status: 404, message: `No drop with id ${id}.` })
    const url = dropPageUrl(event.url.origin, drop.id)
    if (drop.neverExpires) return `This drop never expires: ${url}`
    if (forever) {
      const ids = (await versionChain(drop)).map(item => item.id)
      await db.update(drops).set({ neverExpiresRequest: who.actorName }).where(inArray(drops.id, ids))
      return `Asked the owner to keep this drop forever. They approve it on ${url}`
    }
    await renewDrop(drop)
    return `Renewed for ${expiryPolicy(event).days} days from now: ${url}`
  },
})
