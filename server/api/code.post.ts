import { defineValidatedHandler, HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { runBrowserAction } from "vite-hub/browser/actions"
import { requireRateLimit } from "vite-hub/rate-limit"
import { CodeImageSchema } from "#shared/schemas"
import { createCodeImageLocation, renderCodeSvg } from "../utils/code-image"
import { requireIdentity } from "../utils/identity"

/**
 * Turns code into an image. SVG comes straight from Shiki's tokens; PNG is one stateless Browser Run
 * screenshot of that SVG (no Playwright, no page session). The URL is public and lasts five minutes.
 */
export default defineValidatedHandler({
  validate: { body: CodeImageSchema },
  async handler(event) {
    const who = await requireIdentity(event)
    // Cloudflare Rate Limiting only exists on Workers; local dev skips it.
    if (!import.meta.dev) await requireRateLimit(event, "code-image", { failure: "deny", key: who.userId, limit: 10, window: "1m" })
    const input = await event.req.json()
    const { svg, width, height } = await renderCodeSvg(input)

    let image: Blob = new Blob([svg], { type: "image/svg+xml" })
    if (input.format === "png") {
      const response = await runBrowserAction("screenshot", {
        html: `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`,
        selector: "svg",
        viewport: { width, height, deviceScaleFactor: input.scale },
        screenshotOptions: { type: "png", omitBackground: true },
      })
      if (!response.ok) {
        console.error(JSON.stringify({ counter: "code_image_failure", status: response.status, error: await response.text() }))
        throw new HTTPError({ status: 502, statusText: "The PNG couldn't be rendered. Try format \"svg\"." })
      }
      image = await response.blob()
    }

    const { expiresAt, key } = createCodeImageLocation(input.format)
    const [storageError, stored] = await blob.put(key, image, { access: "private", contentType: input.format === "png" ? "image/png" : "image/svg+xml" })
    if (storageError || !stored.url) throw new HTTPError({ status: 503, statusText: "The code image could not be stored." })
    return { url: new URL(stored.url, event.req.url).href, expiresAt: expiresAt.toISOString() }
  },
})
