import { HTTPError } from "h3"
import * as v from "valibot"
import { CommentPatchSchema } from "#shared/schemas"
import { findCommentByNumber, setResolved, wroteThread } from "../../../utils/comments"
import { routeNumber } from "../../../utils/review-params"
import { mayResolveSite, reviewApi, reviewSession } from "../../../utils/review"

/** Resolve or reopen a thread from the site's page: its author, or anyone signed in who may comment on the site. */
export default reviewApi(async (event) => {
  const { site, who } = await reviewSession(event)
  const thread = await findCommentByNumber(site, await routeNumber(event))
  if (!thread) throw new HTTPError({ status: 404, statusText: "No comment with that number." })
  if (!mayResolveSite(site, who, wroteThread(thread, who)))
    throw new HTTPError({ status: 403, statusText: "Sign in to Drop to resolve other people's comments." })
  const parsed = v.safeParse(CommentPatchSchema, await event.req.json().catch(() => null))
  if (!parsed.success) throw new HTTPError({ status: 400, statusText: parsed.issues[0].message })
  await setResolved(thread, parsed.output.resolved, who)
  return { ok: true }
})
