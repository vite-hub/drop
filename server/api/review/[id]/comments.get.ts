import { MAX_REVIEW_PAGE } from "#shared/review"
import { requireReviewer, reviewApi, reviewSite, siteItems } from "../../../utils/review"

/** What the review script shows on a page: the comments already sent from it (`?page=`, path and query), in brief. */
export default reviewApi(async (event) => {
  const site = await reviewSite(event)
  const { who } = await requireReviewer(event, site)
  const page = event.url.searchParams.get("page")?.slice(0, MAX_REVIEW_PAGE) || undefined
  const items = await siteItems(site, who, event.url.origin, page)
  return {
    url: new URL(`/d/${site.link ?? site.id}`, event.url.origin).href,
    comments: items.map(item => ({ n: item.n, body: item.body, authorName: item.authorName, page: item.page, resolved: item.resolved, createdAt: item.createdAt })),
  }
})
