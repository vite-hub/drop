import { defineHandler, HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { runBrowser } from "vite-hub/browser"

import type { CodeImageInput } from "../browsers/code-image"

function errorMessages(error: unknown): string[] {
  if (error instanceof AggregateError)
    return [error.message, ...error.errors.flatMap(errorMessages)]
  return [error instanceof Error ? error.message : "Unknown browser error"]
}

export default defineHandler(async (event) => {
  let payload: unknown
  try {
    payload = await event.req.json()
  }
  catch {
    throw new HTTPError({ status: 400, statusText: "A JSON code-image request is required." })
  }

  if (!payload || typeof payload !== "object") {
    throw new HTTPError({ status: 400, statusText: "A JSON code-image request is required." })
  }
  const input = payload as Partial<CodeImageInput>
  if (typeof input.code !== "string"
    || input.language !== undefined && typeof input.language !== "string"
    || input.theme !== undefined && typeof input.theme !== "string") {
    throw new HTTPError({ status: 400, statusText: "Code, language, and theme must be strings." })
  }

  let image: Uint8Array
  try {
    image = await runBrowser("code-image", input as CodeImageInput)
  }
  catch (error) {
    console.error(JSON.stringify({
      counter: "code_image_failure",
      errors: errorMessages(error),
    }))
    throw new HTTPError({ status: 502, statusText: "The code image could not be rendered." })
  }

  const key = `${crypto.randomUUID()}.png`
  const [storageError, stored] = await blob.put(key, image, {
    access: "private",
    contentType: "image/png",
  })
  if (storageError || !stored.url)
    throw new HTTPError({ status: 503, statusText: "The code image could not be stored." })

  return { url: new URL(stored.url, event.req.url).href }
})
