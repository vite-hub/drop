import type { H3Event } from "h3"
import { useServerEnv } from "#vitehub/env/server"

/**
 * Apps and HTML docs run real code, and real apps need a real origin: storage, cookies, and history.pushState all
 * throw in an opaque-origin sandbox. `DROP_CONTENT_ORIGIN` names a second hostname served by this same deployment.
 * The viewer frames it, so drops get an origin of their own that still isn't Drop's: they can't read Drop's
 * session or call its API (auth cookies are `__Host-`, and cookie-carrying API writes must come from Drop's origin).
 * Without it, drops keep the opaque sandbox.
 */
function configured(event: H3Event): URL | null {
  const value = useServerEnv(event).drop.contentOrigin?.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    return ["https:", "http:"].includes(url.protocol) ? url : null
  }
  catch { return null }
}

/** Where the viewer frames apps and HTML docs, or null for the opaque sandbox. Never Drop's own origin. */
export function contentOrigin(event: H3Event): string | null {
  const url = configured(event)
  return url && url.host !== event.url.host ? url.origin : null
}

/** Whether this request came in on the content origin rather than Drop itself. */
export function isContentRequest(event: H3Event) {
  return configured(event)?.host === event.url.host
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
