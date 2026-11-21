import { APIError } from "better-auth/api"
import { applySetCookies } from "better-auth/cookies"
import { defineHandler, HTTPError } from "h3"
import { sessionOf } from "../utils/identity"
import { oneSignInAtATime } from "../utils/proxy-auth"
import { isProxyMember, PROXY_TOKEN_HEADER, readAuthProxyConfig } from "../utils/proxy-auth-config"

export default defineHandler(async (event) => {
  const proxy = readAuthProxyConfig()
  if (!proxy.enabled) return
  const path = event.url.pathname
  if (path === "/signin" || path === "/api/sign-in") return
  if (path === "/api/auth/sign-out" && event.req.method === "POST") {
    if (proxy.cookie)
      event.res.headers.append("Set-Cookie", `${proxy.cookie}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`)
    return
  }
  const token = event.req.headers.get(PROXY_TOKEN_HEADER)
  if (!token) return
  if (!(await isProxyMember(token)))
    throw new HTTPError({
      status: 403,
      statusText: "Active organization membership required.",
      data: { code: "GITHUB_MEMBERSHIP_REQUIRED" },
    })
  const session = await oneSignInAtATime(token, () => sessionOf(event)).catch((error: unknown) => {
    if (error instanceof APIError) throw new HTTPError({ status: error.statusCode, statusText: error.message })
    throw error
  })
  if (!session) throw new HTTPError({ status: 403, statusText: "Proxy sign-in failed." })

  const headers = new Headers(event.req.headers)
  const cookies = event.context.dropSessionCookies
  if (cookies?.length) applySetCookies(headers, cookies)
  headers.delete(PROXY_TOKEN_HEADER)
  Object.defineProperty(event.req, "headers", { value: headers, configurable: true })
})
