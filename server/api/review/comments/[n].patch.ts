import { eq } from "drizzle-orm"
import { HTTPError } from "h3"
import * as v from "valibot"
import { db } from "vite-hub/database/drizzle"
import { CommentPatchSchema } from "#shared/schemas"
import { comments } from "../../../databases/config"
import { findCommentByNumber } from "../../../utils/comments"
import { permissions } from "../../../utils/drops"
import { routeNumber } from "../../../utils/review-params"
import { reviewApi, reviewSession } from "../../../utils/review"

/** Resolve or reopen a thread from the site's page: its author or the site's managers, as in Drop. */
export default reviewApi(async (event) => {
  const { site, who } = await reviewSession(event)
  const comment = await findCommentByNumber(site, await routeNumber(event))
  if (!comment) throw new HTTPError({ status: 404, statusText: "No comment with that number." })
  if (!(permissions(site, who).manage || (who && comment.authorId === who.userId)))
    throw new HTTPError({ status: 403, statusText: "Only its author and the review's owners can resolve it." })
  const parsed = v.safeParse(CommentPatchSchema, await event.req.json().catch(() => null))
  if (!parsed.success) throw new HTTPError({ status: 400, statusText: parsed.issues[0].message })
  await db.update(comments).set({ resolved: parsed.output.resolved }).where(eq(comments.id, comment.id))
  return { ok: true }
})
