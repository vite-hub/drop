import { useLogger } from "evlog/nitro/v3"
import { type H3Event, HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { runBrowserAction } from "vite-hub/browser/actions"
import { requireRateLimit } from "vite-hub/rate-limit"
import type { CodeImageInput } from "#shared/schemas"
import { createCodeImageLocation, renderCodeSvg } from "./code-image"
import type { Identity } from "./identity"

/**
 * Turns code into an image. SVG comes straight from Shiki's tokens; PNG is one stateless Browser Run
 * screenshot of that SVG (no Playwright, no page session). The URL is public and lasts five minutes.
 */
export async function createCodeImage(event: H3Event, who: Identity, input: CodeImageInput) {
  // Cloudflare Rate Limiting only exists on Workers; local dev skips it.
  if (!import.meta.dev) await requireRateLimit(event, "code-image", { failure: "deny", key: who.userId, limit: 10, window: "1m" })
  const { svg, width, height } = await renderCodeSvg(input)
  useLogger(event).set({ codeImage: { format: input.format, language: input.language, theme: input.theme, characters: input.code.length } })

  let image: Blob = new Blob([svg], { type: "image/svg+xml" })
  if (input.format === "png") {
    const response = await runBrowserAction("screenshot", {
      html: `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`,
      selector: "svg",
      viewport: { width, height, deviceScaleFactor: input.scale },
      screenshotOptions: { type: "png", omitBackground: true },
    })
    if (!response.ok) {
      useLogger(event).error(new Error(await response.text()), { codeImage: { status: response.status } })
      throw new HTTPError({ status: 502, statusText: "The PNG couldn't be rendered. Try format \"svg\"." })
    }
    image = await response.blob()
  }

  const { expiresAt, key } = createCodeImageLocation(input.format)
  const [storageError, stored] = await blob.put(key, image, { access: "private", contentType: input.format === "png" ? "image/png" : "image/svg+xml" })
  if (storageError || !stored.url) throw new HTTPError({ status: 503, statusText: "The code image could not be stored." })
  return { url: new URL(stored.url, event.req.url).href, expiresAt: expiresAt.toISOString() }
}
