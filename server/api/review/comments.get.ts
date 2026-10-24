import { MAX_REVIEW_PAGE } from "#shared/review"
import { ReviewCommentsQuerySchema } from "#shared/schemas"
import { defineValidatedHandler } from "h3"
import { reviewApi, reviewPage, reviewSession, reviewThreads, siteItems } from "../../utils/review"

/**
 * The threads on a page (`?page=`, path and query), for the review script's pins, and how many are open. Only people
 * who may comment get them, by their token; nothing in them opens the review in Drop. The page's own scripts can read
 * what the review script fetches, which is the trade for seeing the threads where they were left, as in Figma.
 */
export default reviewApi(
  defineValidatedHandler({
    validate: { query: ReviewCommentsQuerySchema },
    async handler(event) {
      const { site, claims, who } = await reviewSession(event)
      const page = event.url.searchParams.get("page")?.slice(0, MAX_REVIEW_PAGE)
      const items = await siteItems(site, who, event.url.origin, page ? reviewPage(site, claims.o, page) : undefined)
      return { open: items.filter((item) => !item.resolved).length, threads: reviewThreads(site, who, items) }
    },
  }),
)
