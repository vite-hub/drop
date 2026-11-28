import { defineValidatedHandler } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { NotesTargetsSchema } from "#shared/schemas"
import { exactOrigin, notesCaller, notesTargets } from "../../../utils/notes"

export default defineValidatedHandler({
  validate: { body: NotesTargetsSchema },
  async handler(event) {
    const who = await notesCaller(event)
    await requireRateLimit(event, "review-notes", { key: who.userId, limit: 60, window: "1m" })
    const origin = exactOrigin(event, (await event.req.json()).origin)
    return { targets: await notesTargets(who, origin, event) }
  },
})
