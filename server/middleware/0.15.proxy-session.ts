import { APIError } from "better-auth/api"
import { applySetCookies, getSessionCookie } from "better-auth/cookies"
import { defineHandler, type H3Event, HTTPError } from "h3"
import { authError } from "../utils/auth-errors"
import { sessionOf } from "../utils/identity"
import { requestLog } from "../utils/logs"
import { oneSignInAtATime, oneSignInPerIdentity } from "../utils/proxy-auth"
import {
  DROP_SECURE_COOKIE_PREFIX,
  isProxyMember,
  PROXY_TOKEN_HEADER,
  readAuthProxyConfig,
} from "../utils/proxy-auth-config"

export default defineHandler(async (event) => {
  const proxy = readAuthProxyConfig()
  if (!proxy.enabled) return
  const path = event.url.pathname
  if (path === "/api/auth/sign-out" && event.req.method === "POST" && proxy.cookie)
    event.res.headers.append("Set-Cookie", `${proxy.cookie}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`)
  const token = event.req.headers.get(PROXY_TOKEN_HEADER)
  if (!token) return
  if (path !== "/signin/start" || sentPath(event) !== path) return withoutToken(event)
  if (!(await isProxyMember(token))) throw authError("GITHUB_MEMBERSHIP_REQUIRED")
  const session = await proxySignIn(event, token).catch((error: unknown) => {
    if (!(error instanceof APIError)) throw error
    const code = typeof error.body?.code === "string" ? error.body.code : undefined
    throw new HTTPError({ status: error.statusCode, statusText: error.message, ...(code ? { data: { code } } : {}) })
  })
  if (!session) {
    requestLog(event)?.set({ auth: { signIn: "proxy failed", cause: "Better Auth refused the forwarded identity" } })
    throw authError("PROXY_SIGN_IN_FAILED")
  }

  withoutToken(event, event.context.dropSessionCookies)
})

async function proxySignIn(event: H3Event, token: string) {
  const { headers } = event.req
  if (getSessionCookie(headers, { cookiePrefix: DROP_SECURE_COOKIE_PREFIX }) || getSessionCookie(headers))
    return oneSignInPerIdentity(token, () => sessionOf(event))

  let ranHere = false
  const { session, cookies } = await oneSignInAtATime(token, async () => {
    ranHere = true
    const before = event.context.dropSessionCookies?.length ?? 0
    const signedIn = await sessionOf(event)
    return { session: signedIn, cookies: event.context.dropSessionCookies?.slice(before) ?? [] }
  })
  if (!ranHere) (event.context.dropSessionCookies ??= []).push(...cookies)
  return session
}

function sentPath(event: H3Event) {
  return event.runtime?.node?.req.url?.split("?")[0] ?? event.url.pathname
}

function withoutToken(event: H3Event, cookies?: string[]) {
  const headers = new Headers(event.req.headers)
  if (cookies?.length) applySetCookies(headers, cookies)
  headers.delete(PROXY_TOKEN_HEADER)
  Object.defineProperty(event.req, "headers", { value: headers, configurable: true })
}
