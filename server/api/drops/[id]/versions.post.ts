import { defineValidatedHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { VersionSchema } from "#shared/schemas"
import { createDocDrop, findDrop, permissions, publishApp, toSummary } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"

/** Publish the next version: new text for a doc, a new file set for an app. People with edit access only. */
export default defineValidatedHandler({
  validate: { body: VersionSchema },
  async handler(event) {
    const drop = await findDrop(await routeId(event), event)
    const who = await identify(event)
    if (!drop || !permissions(drop, who).edit) throw new HTTPError({ status: 404, statusText: "You can't edit this drop." })
    // Cloudflare Rate Limiting only exists on Workers; local dev skips it.
    if (!import.meta.dev) {
      const ip = event.req.headers.get("cf-connecting-ip") ?? event.req.headers.get("x-forwarded-for") ?? "unknown"
      await requireRateLimit(event, "drop-version", { failure: "deny", key: `${drop.id}:${who?.userId ?? ip}`, limit: 20, window: "1m" })
    }
    const editor = who ?? { userId: drop.ownerId, name: "Guest", email: "", image: null, role: "member" as const, actorKind: "browser" as const, actorName: "Guest" }
    const body = await event.req.json()
    if ("files" in body) {
      if (drop.kind !== "app") throw new HTTPError({ status: 400, statusText: "Only apps take files." })
      return toSummary(await publishApp(editor, { id: drop.id, files: body.files }))
    }
    if (drop.kind === "app") throw new HTTPError({ status: 400, statusText: "Apps take files, not content." })
    return toSummary(await createDocDrop(editor, { filename: drop.filename, bytes: new TextEncoder().encode(body.content), supersedes: drop.id }, event))
  },
})
