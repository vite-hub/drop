import { defineHandler, HTTPError, readValidatedBody, requireContentType } from "h3"
import { blob } from "vite-hub/blob"
import { runBrowser } from "vite-hub/browser"
import { deferQueue } from "vite-hub/queue"
import * as v from "valibot"

import { MAX_CODE_CHARACTERS } from "../browsers/code-image"

const CodeImageInputSchema = v.strictObject({
  code: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_CODE_CHARACTERS)),
  language: v.optional(v.string()),
  theme: v.optional(v.string()),
})

export default defineHandler(async (event) => {
  requireContentType(event, "application/json")
  const input = await readValidatedBody(event, CodeImageInputSchema, {
    onError: () => ({
      status: 400,
      statusText: "Invalid code image request",
      message: `Code must contain between 1 and ${MAX_CODE_CHARACTERS} characters. Language and theme must be strings.`,
    }),
  })

  const [browserError, image] = await runBrowser("code-image", input)
  if (browserError) {
    console.error(JSON.stringify({
      counter: "code_image_failure",
      error: browserError.message,
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

  deferQueue("image-optimization", { payload: key })

  return { url: new URL(stored.url, event.req.url).href }
})
