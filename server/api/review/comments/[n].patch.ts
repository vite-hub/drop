import { HTTPError } from "h3"
import * as v from "valibot"
import { CommentPatchSchema } from "#shared/schemas"
import { findCommentByNumber, setResolved, wroteThread } from "../../../utils/comments"
import { permissions } from "../../../utils/drops"
import { routeNumber } from "../../../utils/review-params"
import { reviewApi, reviewSession } from "../../../utils/review"

/** Resolve or reopen a thread from the site's page: its author or the site's managers, as in Drop. */
export default reviewApi(async (event) => {
  const { site, who } = await reviewSession(event)
  const thread = await findCommentByNumber(site, await routeNumber(event))
  if (!thread) throw new HTTPError({ status: 404, statusText: "No comment with that number." })
  if (!(permissions(site, who).manage || wroteThread(thread, who)))
    throw new HTTPError({ status: 403, statusText: "Only its author and the review's owners can resolve it." })
  const parsed = v.safeParse(CommentPatchSchema, await event.req.json().catch(() => null))
  if (!parsed.success) throw new HTTPError({ status: 400, statusText: parsed.issues[0].message })
  await setResolved(thread, parsed.output.resolved, who)
  return { ok: true }
})
