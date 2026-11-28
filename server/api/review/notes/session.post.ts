import { defineValidatedHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { NotesSessionSchema } from "#shared/schemas"
import { exactOrigin, ensureNotes, findNotes, NOTES_TARGET, notesCaller, targetSite } from "../../../utils/notes"
import { permissions } from "../../../utils/drops"
import { signReviewToken } from "../../../utils/review"

export default defineValidatedHandler({
  validate: { body: NotesSessionSchema },
  async handler(event) {
    const who = await notesCaller(event)
    await requireRateLimit(event, "review-notes", { key: who.userId, limit: 60, window: "1m" })
    const body = await event.req.json()
    const origin = exactOrigin(event, body.origin)
    if (body.create && body.target !== NOTES_TARGET)
      throw new HTTPError({ status: 400, statusText: "Only your notes are made on demand." })
    const notes = body.target === NOTES_TARGET
    const found = notes
      ? body.create
        ? await ensureNotes(who, origin, event)
        : await findNotes(who, origin, event)
      : await targetSite(who, origin, body.target, event)
    const site = found && (!notes || permissions(found, who).comment) ? found : null
    if (!site)
      throw new HTTPError({
        status: 404,
        statusText: notes ? "You have no notes on this site yet." : "You can't comment on that review anymore.",
      })
    const { token, expiresAt } = await signReviewToken(event, {
      d: site.id,
      u: who.userId,
      n: who.name,
      o: origin,
      x: 1,
    })
    return { token, expiresAt, origin, title: site.title, name: who.name }
  },
})
