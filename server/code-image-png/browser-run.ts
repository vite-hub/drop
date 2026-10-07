import { useLogger } from "evlog/nitro/v3"
import { type H3Event, HTTPError } from "h3"
import { runBrowserAction } from "vite-hub/browser/actions"

/** PNG code images on Cloudflare: one stateless Browser Run screenshot of the SVG (no Playwright, no page session). */
export const PNG_CODE_IMAGES = true

export async function renderCodePng(event: H3Event, image: { svg: string; width: number; height: number; scale: number }) {
  const response = await runBrowserAction("screenshot", {
    html: `<!doctype html><html><body style="margin:0;background:transparent">${image.svg}</body></html>`,
    selector: "svg",
    viewport: { width: image.width, height: image.height, deviceScaleFactor: image.scale },
    screenshotOptions: { type: "png", omitBackground: true },
  })
  if (!response.ok) {
    useLogger(event).error(new Error(await response.text()), { codeImage: { status: response.status } })
    throw new HTTPError({ status: 502, statusText: "The PNG couldn't be rendered. Try format \"svg\"." })
  }
  return response.blob()
}
