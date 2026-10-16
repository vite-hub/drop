import { defineHandler, defineWebSocketHandler, type H3Event } from "h3"

const ROOM = /^\/api\/_vitehub\/realtime\/drops\/(.+)$/

/**
 * Realtime only checks that someone is signed in. Every room is a drop's draft, so its WebSocket and its checkpoints
 * also need the drop to be live-editable by that person. Anything else gets a 404, before a room is opened.
 *
 * The one exception is the Workspace events channel every editor opens alongside its room (`@workspace`). It relays
 * draft paths only, never text, and Drop doesn't act on it; denying it would only make clients reconnect forever.
 */
export default defineHandler(async (event) => {
  if (!event.url.pathname.startsWith("/api/_vitehub/realtime/")) return
  const [{ draftDropId }, { findDrop, liveEditable, permissions, versionsOf }, { identify }] = await Promise.all([
    import("../utils/draft-paths"), import("../utils/drops"), import("../utils/identity"),
  ])
  if (event.url.pathname === "/api/_vitehub/realtime/drops/%40workspace" && event.url.searchParams.get("workspace") === "events") {
    if (await identify(event)) return
    return deny(event)
  }
  const path = event.url.pathname.match(ROOM)?.[1]
  const id = path ? draftDropId(decodeURIComponent(path)) : null
  const drop = id ? await findDrop(id, event) : null
  const who = drop ? await identify(event) : null
  if (!drop || !who || !liveEditable(drop, permissions(drop, who), await versionsOf(drop))) return deny(event)
  return toRoomObject(event)
})

/**
 * Nitro's cloudflare-durable entry hands every WebSocket to one Durable Object instance (`server`), where the rooms
 * live, while Realtime forwards checkpoints to a Durable Object per room, which has no peers and never matches the
 * room's state (409 forever). Send checkpoints from the Worker to `server` too; inside it, Realtime handles them.
 */
function toRoomObject(event: H3Event) {
  if (event.req.headers.get("upgrade")?.toLowerCase() === "websocket") return
  const cloudflare = (event.req as { runtime?: { cloudflare?: CloudflareRuntime } }).runtime?.cloudflare
    ?? (event.context as { _platform?: { cloudflare?: CloudflareRuntime } })._platform?.cloudflare
  const binding = cloudflare?.env?.$DurableObject
  const insideObject = typeof cloudflare?.context === "object" && cloudflare.context !== null && "storage" in cloudflare.context
  if (!binding || insideObject) return
  return binding.get(binding.idFromName("server")).fetch(event.req)
}

type CloudflareRuntime = {
  context?: unknown
  env?: { $DurableObject?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } } }
}

/**
 * A WebSocket upgrade resolves its hooks from this response, and an error response has none, which crossws still
 * upgrades into a silent socket. So refuse the upgrade itself.
 */
function deny(event: H3Event) {
  if (event.req.headers.get("upgrade")?.toLowerCase() === "websocket")
    return defineWebSocketHandler({ upgrade: () => new Response("Not found", { status: 404 }) })(event)
  return new Response("Not found", { status: 404 })
}
