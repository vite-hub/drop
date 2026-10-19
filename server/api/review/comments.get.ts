import { MAX_REVIEW_PAGE } from "#shared/review"
import { ReviewCommentsQuerySchema } from "#shared/schemas"
import { defineValidatedHandler } from "h3"
import { reviewApi, reviewPage, reviewSession, siteItems } from "../../utils/review"

/**
 * The review script's count for a page (`?page=`, path and query): how many comments sent from it are open. Only the
 * number: the page is someone else's, and the comments are the review's.
 */
export default reviewApi(
  defineValidatedHandler({
    validate: { query: ReviewCommentsQuerySchema },
    async handler(event) {
      const { site, claims, who } = await reviewSession(event)
      const page = event.url.searchParams.get("page")?.slice(0, MAX_REVIEW_PAGE)
      const items = await siteItems(site, who, event.url.origin, page ? reviewPage(site, claims.o, page) : undefined)
      return { open: items.filter((item) => !item.resolved).length }
    },
  }),
)
