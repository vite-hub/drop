import { and, eq } from "drizzle-orm"
import { defineHandler, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { account } from "../databases/config"
import { authFor } from "../utils/identity"
import { isGitHubMember } from "../utils/github-membership"
import { proxyAuthentication } from "../utils/proxy-auth"

/** Establish the same session Drop's browser UI and OAuth consent already use, without a second login. */
export default defineHandler(async (event) => {
  if (!proxyAuthentication) return
  const token = event.req.headers.get("x-auth-request-access-token")
  if (!token) return // Machine OAuth requests use Drop's bearer tokens, not proxy headers.
  if (!await isGitHubMember(token)) throw new HTTPError({ status: 403, statusText: "Active organization membership required." })
  if (event.url.pathname === "/api/auth/sign-out" && event.req.method === "POST")
    event.res.headers.append("Set-Cookie", "__Host-quiver-drop-auth=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax")
  const auth = authFor(event)
  const current = await auth.api.getSession({ headers: event.req.headers }).catch(() => null)
  if (current) {
    const [github] = await db.select({ token: account.accessToken }).from(account)
      .where(and(eq(account.userId, current.user.id), eq(account.providerId, "github"))).limit(1)
    if (github?.token === token) return
  }
  const response = await auth.api.proxySignIn({ headers: event.req.headers, asResponse: true })
  if (!response.ok) throw new HTTPError({ status: response.status, statusText: "Proxy sign-in failed." })
  const cookies = response.headers.getSetCookie()
  for (const cookie of cookies) event.res.headers.append("Set-Cookie", cookie)
  // The current request must see the newly established session as well as the browser's next request.
  const pairs = cookies.map(cookie => cookie.split(";")[0]!)
  const replaced = new Set(pairs.map(cookie => cookie.split("=")[0]))
  const previous = (event.req.headers.get("cookie") ?? "").split(";").filter(cookie => !replaced.has(cookie.trim().split("=")[0]))
  event.req.headers.set("cookie", [...previous, ...pairs].filter(Boolean).join("; "))
})
