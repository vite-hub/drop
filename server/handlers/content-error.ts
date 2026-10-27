import type { H3Event, HTTPError } from "h3"
import { escapeUTF8 as escapeHtml } from "entities"
import { contentUnavailable, contentUnavailableIcon } from "../../shared/content-unavailable.ts"
import RECOVERY_CSS from "../../shared/content-unavailable.css?raw"
import THEME_CSS from "../../shared/theme.css?raw"
import DROP_MARK from "../../shared/drop-mark.svg?raw"
import { readAuthProxyConfig as authProxy } from "../utils/proxy-auth-config.ts"

const theme = `${THEME_CSS.replace(":root.dark {", "@media (prefers-color-scheme: dark) { :root {")}\n}`
const mark = DROP_MARK.replace("<svg ", '<svg class="content-unavailable-mark" aria-hidden="true" focusable="false" ')

async function signedIn(event: H3Event) {
  if (event.context.dropIdentity) return event.context.dropIdentity
  const { identify } = await import("../utils/identity")
  return identify(event)
}

/** Raw file errors need trusted chrome too. Returning nothing keeps Nitro's normal API error handler. */
export default async function contentError(error: HTTPError<{ shareReview?: string }>, event: H3Event) {
  const path = event.url.pathname
  if (!path.startsWith("/f/") && !path.startsWith("/d/")) return
  const status = error.status >= 400 && error.status <= 599 ? error.status : 500
  // Reuse the access gate's identity when it ran. For missing files, resolve it only on this error path.
  let identity: Awaited<ReturnType<typeof signedIn>> = null
  try {
    identity = await signedIn(event)
  } catch {}
  const message = contentUnavailable(
    status,
    `${path}${event.url.search}`,
    identity?.email,
    error.data?.shareReview === "pending",
    authProxy().enabled,
  )
  // A pasted link to a drop a stranger can't open still unfurls as Drop's card (app.vue), not as this error.
  const card = path.startsWith("/d/")
    ? `<meta property="og:site_name" content="Drop"><meta property="og:title" content="Shared on Drop"><meta property="og:image" content="${escapeHtml(event.url.origin)}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">`
    : ""
  const account = message.email
    ? `<p class="content-unavailable-account">Signed in as <bdi>${escapeHtml(message.email)}</bdi></p>`
    : ""
  const github = message.action.to.startsWith("/signin")
    ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6A4.7 4.7 0 0 1 5.6 8.4c-.1-.3-.5-1.6.1-3.3 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 3 .1 3.3a4.7 4.7 0 0 1 1.2 3.2c0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z"/></svg>'
    : ""
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(message.title)} · Drop</title>
  ${card}
  <style>
    ${theme}
    html { font-family: "Geist Variable", ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
    body { margin: 0; background: var(--background); }
    ${RECOVERY_CSS}
    .content-unavailable { min-height: 100dvh; }
  </style>
</head>
<body>
  <main class="content-unavailable">
    <div class="content-unavailable-panel">
      <a class="content-unavailable-brand" href="/">${mark}Drop</a>
      <section class="content-unavailable-card" aria-labelledby="content-unavailable-title">
        <span class="content-unavailable-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="${contentUnavailableIcon(status, error.data?.shareReview === "pending")}"/>
          </svg>
        </span>
        <h1 id="content-unavailable-title" class="content-unavailable-title">${escapeHtml(message.title)}</h1>
        <p class="content-unavailable-description">${escapeHtml(message.description)}</p>
        ${account}
        <nav class="content-unavailable-actions" aria-label="Content recovery">
          <a class="content-unavailable-action" href="${escapeHtml(message.action.to)}">${github}${escapeHtml(message.action.label)}</a>
          ${message.email && message.action.to !== "/drops" ? '<a class="content-unavailable-action content-unavailable-action-secondary" href="/drops">My drops</a>' : ""}
        </nav>
      </section>
      <p class="content-unavailable-footer">
        <a class="content-unavailable-report" aria-label="Report this link" href="/report?target=${encodeURIComponent(path)}">Report</a>
      </p>
    </div>
  </main>
</body>
</html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    },
  )
}
