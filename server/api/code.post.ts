import { defineHandler, HTTPError, readValidatedBody, requireContentType } from "h3"
import { blob } from "vite-hub/blob"
import { runBrowser } from "vite-hub/browser"
import { deferQueue } from "vite-hub/queue"

import { MAX_CODE_CHARACTERS, type CodeImageInput } from "../browsers/code-image"

const CODE_IMAGE_KEYS = new Set<keyof CodeImageInput>(["code", "language", "theme"])

function validateCodeImageInput(input: CodeImageInput): CodeImageInput | false {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return false
  if (Object.keys(input).some(key => !CODE_IMAGE_KEYS.has(key as keyof CodeImageInput)))
    return false
  if (typeof input.code !== "string" || input.code.length < 1 || input.code.length > MAX_CODE_CHARACTERS)
    return false
  if (input.language !== undefined && typeof input.language !== "string")
    return false
  if (input.theme !== undefined && typeof input.theme !== "string")
    return false
  return input
}

export default defineHandler(async (event) => {
  requireContentType(event, "application/json")
  const input = await readValidatedBody(event, validateCodeImageInput, {
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
