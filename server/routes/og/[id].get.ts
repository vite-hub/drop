import { useLogger } from "evlog/nitro/v3"
import { defineHandler, getValidatedRouterParams, type H3Event, redirect } from "h3"
import { useStorage } from "nitro/storage"
import * as v from "valibot"
import { requireRateLimit } from "vite-hub/rate-limit"
import { clientAddress } from "../../utils/client-address"
import { renderOgPng } from "../../utils/code-image-png"

const CARD_TTL = 60 * 60 * 24 * 30
const generic = () => redirect("/og.png", 302)
const Params = v.object({ id: v.pipe(v.string(), v.regex(/^[\w-]{1,64}\.png$/)) })

export default defineHandler(async (event) => {
  const params = await getValidatedRouterParams(event, Params).catch(() => null)
  if (!params) return generic()
  const [{ findDrop, permissions }, { dropExcerpt, OG_HEIGHT, OG_WIDTH, ogCardHtml, ogCardKey }] = await Promise.all([
    import("../../utils/drops"),
    import("../../utils/og"),
  ])
  const id = params.id.slice(0, -".png".length)
  const drop = await findDrop(id, event)
  if (!drop || drop.id !== id || !permissions(drop, null).view) return generic()

  const card = {
    title: drop.title,
    excerpt: await dropExcerpt(drop),
    kind: drop.kind,
    version: drop.version,
    date: drop.createdAt,
  }
  const key = await ogCardKey(drop.id, card)
  const storage = useStorage("cache")
  const cached = await storage.getItemRaw<Uint8Array<ArrayBuffer>>(key).catch((error: unknown) => {
    useLogger(event).warn("OG card cache read failed", {
      ogImage: { cache: "read", failure: error instanceof Error ? error.message : String(error) },
    })
    return null
  })
  if (cached) return png(event, cached)

  if (!(await rendersAllowed(event))) return generic()
  const image = await renderOgPng(event, {
    html: ogCardHtml(card, event.url.origin),
    width: OG_WIDTH,
    height: OG_HEIGHT,
  })
  if (!image) return generic()
  const bytes = new Uint8Array(await image.arrayBuffer())
  await storage.setItemRaw(key, bytes, { ttl: CARD_TTL }).catch((error: unknown) =>
    useLogger(event).error(error instanceof Error ? error : new Error(String(error)), {
      ogImage: { cache: "write" },
    }),
  )
  return png(event, bytes)
})

async function rendersAllowed(event: H3Event) {
  try {
    await requireRateLimit(event, "og-image", { key: clientAddress(event), limit: 20, window: "1m" })
    return true
  } catch (error) {
    if (!(error instanceof Error && "status" in error && error.status === 429))
      useLogger(event).warn("OG card rate limit unavailable", {
        ogImage: { rateLimit: error instanceof Error ? error.message : String(error) },
      })
    else useLogger(event).set({ ogImage: { rateLimited: true } })
    return false
  }
}

const png = (event: H3Event, bytes: Uint8Array<ArrayBuffer>) =>
  // doctor-disable-next-line nitro/request/prefer-route-method-suffix -- crawlers check a card with HEAD; it shares the GET's cache and rendering, so answer it here without the body.
  new Response(event.req.method === "HEAD" ? null : bytes, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
  })
