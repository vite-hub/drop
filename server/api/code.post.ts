import * as v from "valibot"

import {
  CODE_IMAGE_FORMATS,
  CODE_IMAGE_SCALES,
  createCodeImageLocation,
  MAX_CODE_CHARACTERS,
} from "../utils/code-images"

const MAX_CODE_BODY_BYTES = 96 * 1024

const CodeImageInputSchema = v.strictObject({
  code: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_CODE_CHARACTERS)),
  format: v.optional(v.picklist(CODE_IMAGE_FORMATS)),
  language: v.optional(v.string()),
  scale: v.optional(v.picklist(CODE_IMAGE_SCALES)),
  theme: v.optional(v.string()),
})

export default defineHandler(async (event) => {
  await requireRateLimit(event, "code-image", { failure: "deny", limit: 5, window: "1m" })
  requireContentType(event, "application/json")
  await assertBodySize(event, MAX_CODE_BODY_BYTES)
  const input = await readValidatedBody(event, CodeImageInputSchema, {
    onError: () => ({
      status: 400,
      statusText: "Invalid code image request",
      message: `Code must contain between 1 and ${MAX_CODE_CHARACTERS} characters. Format must be png or svg, scale must be 2, 4, or 6, and language and theme must be strings.`,
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

  const format = input.format ?? "png"
  const { expiresAt, key } = createCodeImageLocation(format)
  const [storageError, stored] = await blob.put(key, image, {
    access: "private",
    contentType: format === "png" ? "image/png" : "image/svg+xml",
  })
  if (storageError || !stored.url)
    throw new HTTPError({ status: 503, statusText: "The code image could not be stored." })

  return {
    url: new URL(stored.url, event.req.url).href,
    expiresAt: expiresAt.toISOString(),
  }
})
