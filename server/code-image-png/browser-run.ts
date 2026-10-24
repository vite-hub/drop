import { useLogger } from "evlog/nitro/v3"
import { type H3Event, HTTPError } from "h3"
import { runBrowserAction } from "vite-hub/browser/actions"

/** PNG code images on Cloudflare: one stateless Browser Run screenshot of the SVG (no Playwright, no page session). */
export const PNG_CODE_IMAGES = true

export async function renderCodePng(
  event: H3Event,
  image: { svg: string; width: number; height: number; scale: number },
) {
  const response = await runBrowserAction("screenshot", {
    html: `<!doctype html><html><body style="margin:0;background:transparent">${image.svg}</body></html>`,
    selector: "svg",
    viewport: { width: image.width, height: image.height, deviceScaleFactor: image.scale },
    screenshotOptions: { type: "png", omitBackground: true },
  })
  if (!response.ok) {
    useLogger(event).error(new Error(await response.text()), { codeImage: { status: response.status } })
    throw new HTTPError({ status: 502, statusText: 'The PNG couldn\'t be rendered. Try format "svg".' })
  }
  return response.blob()
}

/** A link preview card (server/utils/og.ts) as a PNG, once its font and icon have loaded. */
export async function renderOgPng(event: H3Event, page: { html: string; width: number; height: number }) {
  // A preview without its card is still a preview: any failure leaves the generic one.
  const response = await runBrowserAction("screenshot", {
    html: page.html,
    viewport: { width: page.width, height: page.height },
    gotoOptions: { waitUntil: "networkidle0", timeout: 15_000 },
    screenshotOptions: { type: "png" },
  })
  // runBrowserAction answers a failure with an error Response; it doesn't throw.
  if (!response.ok) {
    useLogger(event).error(new Error(await response.text()), { ogImage: { status: response.status } })
    return null
  }
  return response.blob()
}
