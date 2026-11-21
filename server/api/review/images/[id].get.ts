import { HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { routeId } from "../../../utils/params"
import { reviewApi, reviewImage, reviewSession } from "../../../utils/review"

export default reviewApi(async (event) => {
  const { site } = await reviewSession(event)
  const image = await reviewImage(site, await routeId(event))
  if (!image) throw new HTTPError({ status: 404, statusText: "No image with that id." })
  const headers: Record<string, string> = {}
  for (const name of ["access-control-allow-origin", "vary"]) {
    const value = event.res.headers.get(name)
    if (value) headers[name] = value
  }
  event.res.headers.delete("Cache-Control")
  const response = await blob.serve(event.req, image.blobKey!, { cacheControl: "private, no-cache", headers })
  if (response.status === 404) throw new HTTPError({ status: 404, statusText: "The image is missing." })
  return response
})
