import { type H3Event, HTTPError } from "h3"

/** Hosts without Cloudflare Browser Run have nothing to screenshot the SVG with: code images are SVG only. */
export const PNG_CODE_IMAGES = false

export async function renderCodePng(
  _event: H3Event,
  _image: { svg: string; width: number; height: number; scale: number },
): Promise<Blob> {
  throw new HTTPError({
    status: 501,
    statusText: 'PNG code images need Cloudflare Browser Run, which this Drop doesn\'t have. Use format "svg".',
  })
}

/** Link previews keep the generic /og.png here. */
export async function renderOgPng(
  _event: H3Event,
  _page: { html: string; width: number; height: number },
): Promise<Blob | null> {
  return null
}
