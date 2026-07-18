import { blob } from "@vite-hub/blob"
import { defineHandler, getRouterParam, HTTPError } from "h3"

const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/

export default defineHandler(async (event) => {
  // TODO use valibot + h3 utils
  const key = getRouterParam(event, "key", { decode: false }) || ""
  if (!keyPattern.test(key)) throw new HTTPError({ status: 404, statusText: "Image not found" })

  event.res.headers.set("Cache-Control", "public, max-age=300")
  event.res.headers.set("Content-Disposition", "inline")
  event.res.headers.set("X-Content-Type-Options", "nosniff")

  return await blob.serve(event, key)
})
