import type { H3Event } from "h3"
import { useServerEnv } from "#vitehub/env/server"
import { siteMatches } from "#shared/review"

/**
 * Apps and HTML docs run real code, and real apps need a real origin: storage, cookies, and history.pushState all
 * throw in an opaque-origin sandbox. `DROP_CONTENT_ORIGIN` names hostnames served by this same deployment, which the
 * viewer frames, so drops never run on Drop's origin: they can't read Drop's session or call its API (auth cookies
 * are `__Host-`, and cookie-carrying API writes must come from Drop's origin).
 *
 * With a wildcard every drop gets an origin of its own, like an app on its own subdomain, so one drop can't read
 * another's localStorage, IndexedDB, or caches. The `*` stands for part of the first label: `https://*.usercontent.example`
 * gives `<label>.usercontent.example`, and `https://*-drop.example.com` gives `<label>-drop.example.com`, one level under
 * the zone, where a free certificate still reaches. The label is a keyed hash of the doc's link key, the same on every
 * version, not the key itself, because hostnames travel in clear text (DNS, TLS SNI) and the key opens a shared drop. A plain hostname puts
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

/**
 * A DNS label for `dropId`: 26 base32 characters of an HMAC under the auth secret. Stable, and says nothing about the id.
 * Once ViteHub ships VITEHUB_SECRET (vite-hub/vitehub#2308), key it with `deriveSecret("drop:content-origin")` instead.
 */
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

/** Where the viewer frames the drop `dropId` names (an app or HTML doc, by its link key), or null for the opaque sandbox. Never Drop's own origin. */
export async function contentOrigin(event: H3Event, dropId: string): Promise<string | null> {
  const config = configured(event)
  if (!config) return null
  const name = config.perDrop ? `${config.perDrop.prefix}${await contentLabel(event, dropId)}${config.perDrop.suffix}` : config.host
  const host = `${name}${config.port ? `:${config.port}` : ""}`
  return host === event.url.host ? null : `${config.protocol}//${host}`
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * How this request's host relates to the content origin: `content` for a drop's own host, `stray` for a host that has
 * the wildcard's shape but no valid label (evil-drop.example.com), which a `*-drop.example.com/*` route also sends
 * here and which must not serve a copy of Drop, and `false` for anything else, such as Drop itself.
 */
export function contentHost(event: H3Event): "content" | "stray" | false {
  const config = configured(event)
  if (!config) return false
  const { hostname, port } = event.url
  if (port !== config.port) return false
  if (!config.perDrop) return hostname === config.host && "content"
  const { prefix, suffix } = config.perDrop
  if (new RegExp(`^${escape(prefix)}${LABEL}${escape(suffix)}$`).test(hostname)) return "content"
  // Only when the `*` shares its label with fixed text (`*-drop`): a whole level (`*.example.com`) may also hold Drop.
  if (!prefix && suffix.startsWith(".")) return false
  return hostname.length > prefix.length + suffix.length && hostname.startsWith(prefix) && hostname.endsWith(suffix) && !hostname.slice(prefix.length, -suffix.length).includes(".") && "stray"
}

/** Whether this request came in on a content origin rather than Drop itself. */
export const isContentRequest = (event: H3Event) => contentHost(event) === "content"

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

/**
 * Whether a site review's address reaches Drop itself or its content origin. Reviewing either inside Drop would frame
 * Drop's own pages, or other people's drops, in Drop's page, so neither can be a site to review.
 */
export function siteCoversDrop(event: H3Event, siteUrl: string): boolean {
  if (siteMatches(siteUrl, event.url.origin)) return true
  const config = configured(event)
  if (!config) return false
  if (!siteUrl.includes("*")) {
    const { hostname, port } = new URL(siteUrl)
    if (port !== config.port) return false
    return config.perDrop ? new RegExp(`^${escape(config.perDrop.prefix)}${LABEL}${escape(config.perDrop.suffix)}$`).test(hostname) : hostname === config.host
  }
  // A pattern covers the content origin when it covers any one drop's host on it.
  const sample = config.perDrop ? `${config.perDrop.prefix}${"a".repeat(26)}${config.perDrop.suffix}` : config.host
  return siteMatches(siteUrl, `${config.protocol}//${sample}${config.port ? `:${config.port}` : ""}`)
}
