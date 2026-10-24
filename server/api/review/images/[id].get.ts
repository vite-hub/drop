import { HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { routeId } from "../../../utils/params"
import { reviewApi, reviewImage, reviewSession } from "../../../utils/review"

/**
 * A screenshot or a thread's image, for the review script to show on the site's page. The page can't send Drop's
 * cookies, so /f/ won't do: the script fetches this with its token and shows the bytes from a blob URL.
 */
export default reviewApi(async (event) => {
  const { site } = await reviewSession(event)
  const image = await reviewImage(site, await routeId(event))
  if (!image) throw new HTTPError({ status: 404, statusText: "No image with that id." })
  const [error, file] = await blob.get(image.blobKey!)
  if (error || !file) throw new HTTPError({ status: 404, statusText: "The image is missing." })
  const headers = new Headers({
    "Content-Type": image.contentType ?? "application/octet-stream",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  })
  for (const name of ["access-control-allow-origin", "vary"]) {
    const value = event.res.headers.get(name)
    if (value) headers.set(name, value)
  }
  return new Response(file.stream(), { headers })
})
