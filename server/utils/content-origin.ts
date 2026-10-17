import type { H3Event } from "h3"
import { useServerEnv } from "#vitehub/env/server"

/**
 * Apps and HTML docs run real code, and real apps need a real origin: storage, cookies, and history.pushState all
 * throw in an opaque-origin sandbox. `DROP_CONTENT_ORIGIN` names hostnames served by this same deployment, which the
 * viewer frames, so drops never run on Drop's origin: they can't read Drop's session or call its API (auth cookies
 * are `__Host-`, and cookie-carrying API writes must come from Drop's origin).
 *
 * With a wildcard (`https://*.drop-usercontent.example.com`) every drop gets an origin of its own, like an app on
 * its own subdomain, so one drop can't read another's localStorage, IndexedDB, or caches. The label is a keyed hash
 * of the drop's id, not the id, because hostnames travel in clear text (DNS, TLS SNI) and a shared drop's id is the
 * key to its link. A plain hostname puts every drop on that one origin, sharing storage. Without either, drops keep
 * the opaque sandbox.
 */
function configured(event: H3Event): { protocol: string; base: string; port: string; perDrop: boolean } | null {
  const value = useServerEnv(event).drop.contentOrigin.trim()
  if (!value) return null
  const perDrop = /^[a-z]+:\/\/\*\./i.test(value)
  try {
    const url = new URL(perDrop ? value.replace("*.", "drop.") : value)
    if (!["https:", "http:"].includes(url.protocol)) return null
    return { protocol: url.protocol, base: perDrop ? url.hostname.slice("drop.".length) : url.hostname, port: url.port, perDrop }
  }
  catch { return null }
}

const LABEL = /^[a-z2-7]{26}$/

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
  const host = `${config.perDrop ? `${await contentLabel(event, dropId)}.` : ""}${config.base}${config.port ? `:${config.port}` : ""}`
  return host === event.url.host ? null : `${config.protocol}//${host}`
}

/** Whether this request came in on a content origin rather than Drop itself. */
export function isContentRequest(event: H3Event) {
  const config = configured(event)
  if (!config) return false
  const { hostname, port } = event.url
  if (port !== config.port) return false
  if (!config.perDrop) return hostname === config.base
  return hostname.endsWith(`.${config.base}`) && LABEL.test(hostname.slice(0, -config.base.length - 1))
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
