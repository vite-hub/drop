import { defineValidatedHandler, HTTPError } from "h3"
import * as v from "valibot"
import { requireRateLimit } from "vite-hub/rate-limit"
import { joinFrontmatter, splitFrontmatter } from "#shared/frontmatter"
import { createDocDrop, findDrop, permissions, readText, toSummary, versionsOf } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { deleteDrafts, readDraft } from "#live-drafts"
import { routeId } from "../../../utils/params"
import { quotaApiHandler } from "../../../utils/quotas"

/**
 * Publishes a Markdown drop's live draft as its next version. The text comes from the draft the room last
 * checkpointed, with the published front matter put back. If someone (often an agent) published a newer version
 * meanwhile, this is a 409 naming it, unless `force` puts the draft on top of it. People only: agents publish with
 * publish.
 */
export default quotaApiHandler(defineValidatedHandler({
  validate: { body: v.object({ force: v.optional(v.boolean()) }) },
  async handler(event) {
    const drop = await findDrop(await routeId(event), event)
    const who = await identify(event)
    if (!drop || !who || who.actorKind !== "browser" || drop.kind !== "markdown" || !drop.blobKey || !permissions(drop, who).edit)
      throw new HTTPError({ status: 404, statusText: "You can't edit this drop." })
    await requireRateLimit(event, "drop-version", { key: `${drop.id}:${who.userId}`, limit: 20, window: "1m" })
    const { force } = await event.req.json()
    const head = (await versionsOf(drop))[0]!
    if (head.id !== drop.id && !force)
      throw new HTTPError({ status: 409, statusText: `v${head.version} was published while you were editing.`, data: { head: { id: head.id, version: head.version } } })
    const draft = await readDraft(drop.id)
    if (draft === null) throw new HTTPError({ status: 404, statusText: "There is no draft to publish." })
    const source = await readText(drop.blobKey)
    const content = joinFrontmatter(splitFrontmatter(source).frontmatter, draft)
    if (content === source && head.id === drop.id) return { ...toSummary(drop), unchanged: true }
    const next = await createDocDrop(who, { filename: drop.filename, bytes: new TextEncoder().encode(content), supersedes: head.id }, event)
    await deleteDrafts([drop.id])
    return toSummary(next)
  },
}))
