import { getCookie, type H3Event } from "h3"
import { ATTEMPT_COOKIE, type SignInVia, signInVia } from "#shared/sign-in"
import { logClientEvent } from "./logs"
import { readAuthProxyConfig } from "./proxy-auth-config"

function attemptCookie(event: H3Event, value: string, maxAge: number) {
  const secure = event.url.protocol === "https:" ? "; Secure" : ""
  event.res.headers.append("Set-Cookie", `${ATTEMPT_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`)
}

export function markSignInAttempt(event: H3Event, via: SignInVia) {
  if (via === "card") logClientEvent(event, { event: "signin.clicked", mode: "github", via })
  attemptCookie(event, via, 600)
}

export function logSignedIn(event: H3Event | undefined, context: { path?: string } | null) {
  if (!event) return
  const mode = readAuthProxyConfig().enabled ? "proxy" : context?.path?.startsWith("/callback/") ? "github" : "password"
  const marked = signInVia(getCookie(event, ATTEMPT_COOKIE))
  const via =
    (mode === "proxy" && event.url.pathname === "/signin/start"
      ? signInVia(event.url.searchParams.get("via"))
      : undefined) ?? marked
  logClientEvent(event, { event: "signin.returned", mode, ...(via ? { via } : {}) })
  if (marked) attemptCookie(event, "", 0)
}
