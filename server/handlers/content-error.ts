import type { H3Event, HTTPError } from "h3"

/** Raw file errors need trusted chrome too. Returning nothing keeps Nitro's normal API error handler. */
export default function contentError(error: HTTPError, event: H3Event) {
  const path = event.url.pathname
  if (!path.startsWith("/f/") && !path.startsWith("/d/")) return
  const status = error.status >= 400 && error.status <= 599 ? error.status : 500
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Content unavailable · Drop</title><style>body{font:16px system-ui;margin:12vh auto;padding:24px;max-width:36rem}a{color:inherit;margin-right:24px}</style></head><body><h1>This content is unavailable.</h1><p>The file may be private, removed, or waiting for review.</p><a href="/">Home</a><a href="/report?target=${encodeURIComponent(path)}">Report</a></body></html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  })
}
