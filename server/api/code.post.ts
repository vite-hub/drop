import { createError } from "evlog"
import * as v from "valibot"

const MAX_CODE_BODY_BYTES = 96 * 1024

const CodeImageInputSchema = v.strictObject({
  code: v.pipe(v.string(), v.minLength(1), v.maxLength(CODE_IMAGE_MAX_CHARACTERS)),
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
      message: `Code must contain between 1 and ${CODE_IMAGE_MAX_CHARACTERS} characters. Format must be png or svg, scale must be 2, 4, or 6, and language and theme must be strings.`,
    }),
  })

  const [browserError, image] = await runBrowser("code-image", input)
  if (browserError)
    throw createError({
      cause: browserError,
      code: "DROP_CODE_IMAGE_RENDER_FAILED",
      message: "The code image could not be rendered.",
      status: 502,
    })

  const format = input.format ?? "png"
  const { expiresAt, key } = createCodeImageLocation(format)
  const [storageError, stored] = await blob.put(key, image, {
    access: "private",
    contentType: format === "png" ? "image/png" : "image/svg+xml",
  })
  if (storageError || !stored.url) {
    throw createError({
      cause: storageError ?? undefined,
      code: "DROP_CODE_IMAGE_STORAGE_FAILED",
      message: "The code image could not be stored.",
      status: 503,
    })
  }

  return {
    url: new URL(stored.url, event.req.url).href,
    expiresAt: expiresAt.toISOString(),
  }
})
