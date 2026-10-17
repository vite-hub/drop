import { reviewApi, reviewSite } from "../../../utils/review"

/** The preflight for the review script's requests: allowed for the site's own origin, with its token, no cookies. */
export default reviewApi(async (event) => {
  await reviewSite(event)
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": event.res.headers.get("access-control-allow-origin")!,
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin",
    },
  })
})
