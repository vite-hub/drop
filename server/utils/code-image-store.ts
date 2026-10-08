import { useLogger } from "evlog/nitro/v3"
import { type H3Event, HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database/drizzle"
import { codeImages } from "../databases/config"
import { requireRateLimit } from "vite-hub/rate-limit"
import { PNG_CODE_IMAGES, renderCodePng } from "#code-image-png"
import type { CodeImageInput } from "#shared/schemas"
import { createCodeImageLocation, renderCodeSvg } from "./code-image"
import type { Identity } from "./identity"

/**
 * Turns code into an image. SVG comes straight from Shiki's tokens; PNG is a Browser Run screenshot of that
 * SVG, so only Drops on Cloudflare have it (and default to it). The URL is public and lasts five minutes.
 */
export async function createCodeImage(event: H3Event, who: Identity, input: CodeImageInput) {
  // Cloudflare Rate Limiting on Workers, ViteHub's in-memory limiter elsewhere; local dev skips it.
  if (!import.meta.dev) await requireRateLimit(event, "code-image", { failure: "deny", key: who.userId, limit: 10, window: "1m" })
  const format = input.format ?? (PNG_CODE_IMAGES ? "png" : "svg")
  const { svg, width, height } = await renderCodeSvg(input)
  useLogger(event).set({ codeImage: { format, language: input.language, theme: input.theme, characters: input.code.length } })

  const image = format === "png" ? await renderCodePng(event, { svg, width, height, scale: input.scale }) : new Blob([svg], { type: "image/svg+xml" })

  const { expiresAt, key } = createCodeImageLocation(format)
  const [storageError, stored] = await blob.put(key, image, { access: "private", contentType: format === "png" ? "image/png" : "image/svg+xml" })
  if (storageError || !stored.url) throw new HTTPError({ status: 503, statusText: "The code image could not be stored." })
  try {
    await db.insert(codeImages).values({ blobKey: key, ownerId: who.userId, expiresAt: expiresAt.getTime() })
  }
  catch (error) {
    await blob.del(key)
    throw error
  }
  return { url: new URL(stored.url, event.req.url).href, expiresAt: expiresAt.toISOString() }
}
