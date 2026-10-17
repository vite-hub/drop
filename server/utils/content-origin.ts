import type { H3Event } from "h3"
import { useServerEnv } from "#vitehub/env/server"

/**
 * Apps and HTML docs run real code, and real apps need a real origin: storage, cookies, and history.pushState all
 * throw in an opaque-origin sandbox. `DROP_CONTENT_ORIGIN` names hostnames served by this same deployment, which the
 * viewer frames, so drops never run on Drop's origin: they can't read Drop's session or call its API (auth cookies
 * are `__Host-`, and cookie-carrying API writes must come from Drop's origin).
 *
 * With a wildcard every drop gets an origin of its own, like an app on its own subdomain, so one drop can't read
 * another's localStorage, IndexedDB, or caches. The `*` stands for part of the first label: `https://*.usercontent.example`
 * gives `<label>.usercontent.example`, and `https://*-drop.example.com` gives `<label>-drop.example.com`, one level under
 * the zone, where a free certificate still reaches. The label is a keyed hash of the drop's id, not the id, because
 * hostnames travel in clear text (DNS, TLS SNI) and a shared drop's id is the key to its link. A plain hostname puts
 * every drop on that one origin, sharing storage. Without either, drops keep the opaque sandbox.
 */
interface ContentConfig { protocol: string; port: string; host: string; perDrop?: { prefix: string; suffix: string } }

function configured(event: H3Event): ContentConfig | null {
  const value = useServerEnv(event).drop.contentOrigin.trim()
  const match = value.match(/^(https?):\/\/([^/:?#]+)(?::(\d+))?\/?$/i)
  if (!match) return null
  const [, scheme, host, port = ""] = match
  const protocol = `${scheme!.toLowerCase()}:`
  const name = host!.toLowerCase()
  if (!name.includes("*")) {
    try { return { protocol, port, host: new URL(`${protocol}//${name}`).hostname } }
    catch { return null }
  }
  // One `*`, inside the first label, with a domain after it.
  const at = name.indexOf("*")
  const firstDot = name.indexOf(".")
  if (name.indexOf("*", at + 1) !== -1 || firstDot === -1 || at > firstDot) return null
  const prefix = name.slice(0, at), suffix = name.slice(at + 1)
  try { new URL(`${protocol}//${prefix}a${suffix}`) }
  catch { return null }
  return { protocol, port, host: name, perDrop: { prefix, suffix } }
}

const LABEL = "[a-z2-7]{26}"

/** A DNS label for `dropId`: 26 base32 characters of an HMAC under the auth secret. Stable, and says nothing about the id. */
export async function contentLabel(event: H3Event, dropId: string): Promise<string> {
  const secret = (useServerEnv(event) as { auth?: { secret?: { unseal: () => string } } }).auth?.secret?.unseal() || "drop-content-origin"
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`content-origin:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(dropId)))
  let bits = 0, value = 0, label = ""
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5 && label.length < 26) {
      label += "abcdefghijklmnopqrstuvwxyz234567"[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return label
}

/** Where the viewer frames `dropId` (an app or HTML doc), or null for the opaque sandbox. Never Drop's own origin. */
export async function contentOrigin(event: H3Event, dropId: string): Promise<string | null> {
  const config = configured(event)
  if (!config) return null
  const name = config.perDrop ? `${config.perDrop.prefix}${await contentLabel(event, dropId)}${config.perDrop.suffix}` : config.host
  const host = `${name}${config.port ? `:${config.port}` : ""}`
  return host === event.url.host ? null : `${config.protocol}//${host}`
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Whether this request came in on a content origin rather than Drop itself. */
export function isContentRequest(event: H3Event) {
  const config = configured(event)
  if (!config) return false
  const { hostname, port } = event.url
  if (port !== config.port) return false
  if (!config.perDrop) return hostname === config.host
  return new RegExp(`^${escape(config.perDrop.prefix)}${LABEL}${escape(config.perDrop.suffix)}$`).test(hostname)
}

/**
 * The only page the content origin serves, at every path so an app sees the URL it was built for. The viewer sends
 * the document over postMessage, so private drops and unpublished edits never pass through this origin's server.
 * Opened outside a frame it shows nothing: there is no parent to take a document from.
 */
export const FRAME_HOST_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Drop</title></head><body><script>(() => {
  if (parent === window) { document.body.textContent = "This domain shows previews inside Drop."; return; }
  addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== parent || !message || message.__drop !== true || message.type !== "document" || typeof message.html !== "string") return;
    document.open();
    document.write(message.html);
    document.close();
  });
  parent.postMessage({ __drop: true, type: "host", path: location.pathname }, "*");
})();</script></body></html>`
