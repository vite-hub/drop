import type { H3Event, HTTPError } from "h3"
import { escapeUTF8 as escapeHtml } from "entities"
import { contentUnavailable } from "../../shared/content-unavailable.ts"
import { authProxy } from "../utils/proxy-auth-config.ts"

/** Raw file errors need trusted chrome too. Returning nothing keeps Nitro's normal API error handler. */
export default async function contentError(error: HTTPError<{ shareReview?: string }>, event: H3Event) {
  const path = event.url.pathname
  if (!path.startsWith("/f/") && !path.startsWith("/d/")) return
  const status = error.status >= 400 && error.status <= 599 ? error.status : 500
  // Reuse the access gate's identity when it ran. For missing files, resolve it only on this error path.
  const identity = await (event.context.dropIdentity
    ? event.context.dropIdentity
    : import("../utils/identity").then(({ identify }) => identify(event)))
    .catch(() => null)
  const message = contentUnavailable(status, `${path}${event.url.search}`, identity?.email, error.data?.shareReview === "pending", authProxy().enabled)
  const account = message.email ? `<p>Signed in as <strong>${escapeHtml(message.email)}</strong>.</p>` : ""
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(message.title)} · Drop</title><style>html{color-scheme:light dark}body{font:16px system-ui;margin:0;min-height:100dvh;display:grid;place-items:center}main{max-width:28rem;padding:32px 24px;text-align:center}h1{font-size:1.3rem;line-height:1.4}p{line-height:1.6;opacity:.75;overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:24px}a{color:inherit;padding:10px 14px;text-decoration:none;border:1px solid currentColor;border-radius:6px}a:focus-visible{outline:2px solid currentColor;outline-offset:4px}</style></head><body><main><h1>${escapeHtml(message.title)}</h1>${account}<p>${escapeHtml(message.description)}</p><nav aria-label="Content recovery"><a href="${escapeHtml(message.action.to)}">${escapeHtml(message.action.label)}</a>${message.email && message.action.to !== "/drops" ? '<a href="/drops">My drops</a>' : ""}<a href="/report?target=${encodeURIComponent(path)}">Report</a></nav></main></body></html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  })
}
