import type { H3Event } from "h3"
import { deriveSecret, useServerEnv } from "vite-hub/env"
import { siteMatches } from "#shared/review"
import { escapeRegExp } from "#shared/utils/text"

interface ContentConfig {
  protocol: string
  port: string
  host: string
  perDrop?: { prefix: string; suffix: string }
}

function configured(event: H3Event): ContentConfig | null {
  const value = useServerEnv(event).drop.contentOrigin.trim()
  const match = value.match(/^(https?):\/\/([^/:?#]+)(?::(\d+))?\/?$/i)
  if (!match) return null
  const [, scheme, host, port = ""] = match
  const protocol = `${scheme!.toLowerCase()}:`
  const name = host!.toLowerCase()
  if (!name.includes("*")) {
    try {
      return { protocol, port, host: new URL(`${protocol}//${name}`).hostname }
    } catch {
      return null
    }
  }
  const at = name.indexOf("*")
  const firstDot = name.indexOf(".")
  if (name.includes("*", at + 1) || firstDot === -1 || at > firstDot) return null
  const prefix = name.slice(0, at),
    suffix = name.slice(at + 1)
  try {
    const valid = new URL(`${protocol}//${prefix}a${suffix}`)
    if (!valid.hostname) return null
  } catch {
    return null
  }
  return { protocol, port, host: name, perDrop: { prefix, suffix } }
}

const LABEL = "[a-z2-7]{26}"

async function contentLabel(event: H3Event, dropId: string): Promise<string> {
  const secret = await deriveSecret("drop:content-origin", { event })
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(dropId)))
  let bits = 0,
    value = 0,
    label = ""
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

export const perDropOrigins = (event: H3Event) => !!configured(event)?.perDrop

export function contentOriginPattern(event: H3Event) {
  const config = configured(event)
  return config ? `${config.protocol}//${config.host}${config.port ? `:${config.port}` : ""}` : undefined
}

export async function contentOrigin(event: H3Event, dropId: string): Promise<string | null> {
  const config = configured(event)
  if (!config) return null
  const host = await hostFor(event, config, dropId)
  return host === event.url.host ? null : `${config.protocol}//${host}`
}

async function hostFor(event: H3Event, config: ContentConfig, dropId: string) {
  const name = config.perDrop
    ? `${config.perDrop.prefix}${await contentLabel(event, dropId)}${config.perDrop.suffix}`
    : config.host
  return `${name}${config.port ? `:${config.port}` : ""}`
}

export async function onOwnOrigin(event: H3Event, dropId: string): Promise<boolean> {
  const config = configured(event)
  return !!config?.perDrop && (await hostFor(event, config, dropId)) === event.url.host
}

export function contentHost(event: H3Event): "content" | "stray" | false {
  const config = configured(event)
  if (!config) return false
  const { hostname, port } = event.url
  if (port !== config.port) return false
  if (!config.perDrop) return hostname === config.host && "content"
  const { prefix, suffix } = config.perDrop
  if (new RegExp(`^${escapeRegExp(prefix)}${LABEL}${escapeRegExp(suffix)}$`).test(hostname)) return "content"
  if (!prefix && suffix.startsWith(".")) return false
  return (
    hostname.length > prefix.length + suffix.length &&
    hostname.startsWith(prefix) &&
    hostname.endsWith(suffix) &&
    !hostname.slice(prefix.length, -suffix.length).includes(".") &&
    "stray"
  )
}

export const FRAME_HOST_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Drop</title></head><body><script data-vitehub-page-tools>(() => {
  if (parent === window) { document.body.textContent = "This domain shows previews inside Drop."; return; }
  const ask = () => parent.postMessage({ __drop: true, type: "host", path: location.pathname + location.search + location.hash }, "*");
  addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== parent || !message || message.__drop !== true) return;
    if (message.type === "hello") return ask();
    if (typeof message.grant === "string" && /^[\\w.:-]+$/.test(message.grant))
      document.cookie = "drop_grant=" + message.grant + "; Path=/; Max-Age=43200" + (isSecureContext ? "; Secure; SameSite=None; Partitioned" : "; SameSite=Lax");
    if (message.type === "read" && typeof message.page === "string") {
      const page = message.page;
      return void fetch("/" + page.split("/").map(encodeURIComponent).join("/"), { cache: "no-store", headers: { "x-drop-read": "page" } })
        .then((response) => (response.ok ? response.text() : undefined))
        .catch(() => undefined)
        .then((html) => parent.postMessage({ __drop: true, type: "page", page, html }, "*"));
    }
    if (message.type !== "document" || typeof message.html !== "string") return;
    // A written document paints before its stylesheets load, unlike one the browser navigates to, so an app would show
    // unstyled first. Keep it hidden until they load or fail, with a 3-second cap for a stylesheet that never answers.
    const hold = "<style data-drop-hold>html{visibility:hidden!important}</style>";
    const head = /<head(?:\\s[^>]*)?>/i.exec(message.html);
    const at = head ? head.index + head[0].length : (/^\\s*<!doctype[^>]*>/i.exec(message.html)?.[0].length ?? 0);
    document.open();
    document.write(message.html.slice(0, at) + hold + message.html.slice(at));
    document.close();
    const rootStyle = document.documentElement?.style;
    const previousVisibility = rootStyle?.getPropertyValue("visibility") ?? "";
    const previousVisibilityPriority = rootStyle?.getPropertyPriority("visibility") ?? "";
    rootStyle?.setProperty("visibility", "hidden", "important");
    const reveal = () => {
      if (previousVisibility) rootStyle?.setProperty("visibility", previousVisibility, previousVisibilityPriority);
      else rootStyle?.removeProperty("visibility");
      document.querySelector("style[data-drop-hold]")?.remove();
    };
    const pending = [...document.querySelectorAll('link[rel~="stylesheet" i]')].filter(
      (link) => !link.sheet && !link.disabled && (!link.media || matchMedia(link.media).matches));
    if (!pending.length) return reveal();
    let left = pending.length;
    for (const link of pending)
      for (const type of ["load", "error"]) link.addEventListener(type, () => --left || reveal(), { once: true });
    setTimeout(reveal, 3000);
  });
  ask();
})();</script></body></html>`

export function siteCoversDrop(event: H3Event, siteUrl: string): boolean {
  if (siteMatches(siteUrl, event.url.origin)) return true
  const config = configured(event)
  if (!config) return false
  if (!siteUrl.includes("*")) {
    const { hostname, port } = new URL(siteUrl)
    if (port !== config.port) return false
    return config.perDrop
      ? new RegExp(`^${escapeRegExp(config.perDrop.prefix)}${LABEL}${escapeRegExp(config.perDrop.suffix)}$`).test(
          hostname,
        )
      : hostname === config.host
  }
  const sample = config.perDrop ? `${config.perDrop.prefix}${"a".repeat(26)}${config.perDrop.suffix}` : config.host
  return siteMatches(siteUrl, `${config.protocol}//${sample}${config.port ? `:${config.port}` : ""}`)
}
