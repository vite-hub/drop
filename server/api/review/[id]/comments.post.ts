import { useLogger } from "evlog/nitro/v3"
import { HTTPError } from "h3"
import * as v from "valibot"
import { requireRateLimit } from "vite-hub/rate-limit"
import { MAX_FILE_BYTES, ReviewCommentSchema } from "#shared/schemas"
import { addReviewComment, requireReviewer, reviewApi, reviewSite, type Screenshot, screenshotType } from "../../../utils/review"

/**
 * A comment from a site under review: `data` (JSON, ReviewCommentSchema) and an optional `screenshot` of the viewport,
 * as multipart. Everything here comes from someone else's page, so it's checked like any upload: the screenshot by its
 * bytes, not its claimed type, and at most 4 MiB.
 */
export default reviewApi(async (event) => {
  const site = await reviewSite(event)
  const { claims, who } = await requireReviewer(event, site).catch(async (error) => {
    await event.req.body?.cancel().catch(() => {})
    throw error
  })
  await requireRateLimit(event, "review-comment", { key: claims.u ?? undefined, limit: 20, window: "1m" })
  if (Number(event.req.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 64 * 1024)
    throw new HTTPError({ status: 413, statusText: "The screenshot exceeds the 4 MiB limit." })

  let form: FormData
  try { form = await event.req.formData() }
  catch { throw new HTTPError({ status: 400, statusText: "Send the comment as multipart form data." }) }
  const data = form.get("data")
  let input
  try { input = v.parse(ReviewCommentSchema, JSON.parse(typeof data === "string" ? data : "")) }
  catch (error) { throw new HTTPError({ status: 400, statusText: v.isValiError(error) ? error.message : "The comment is missing." }) }

  const file = form.get("screenshot")
  let shot: Screenshot | null = null
  if (file instanceof File) {
    if (file.size > MAX_FILE_BYTES) throw new HTTPError({ status: 413, statusText: "The screenshot exceeds the 4 MiB limit." })
    const bytes = new Uint8Array(await file.arrayBuffer())
    const contentType = screenshotType(bytes)
    if (!contentType) throw new HTTPError({ status: 400, statusText: "The screenshot must be a PNG, JPEG, or WebP image." })
    shot = { bytes, contentType }
  }
  else if (file !== null) throw new HTTPError({ status: 400, statusText: "The screenshot must be a file." })

  const comment = await addReviewComment(site, { who, name: claims.n }, input, shot)
  useLogger(event).set({ review: { site: site.id, comment: comment.n, screenshot: Boolean(shot) } })
  return { n: comment.n, url: new URL(`/d/${site.link ?? site.id}`, event.url.origin).href }
})
