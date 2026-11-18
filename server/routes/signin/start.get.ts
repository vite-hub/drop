import { defineHandler, redirect } from "h3"
import { nextPath } from "#shared/sign-in"
import { authFor, identify } from "../../utils/identity"
import { logError } from "../../utils/logs"
import { authProxy } from "../../utils/proxy-auth"

/**
 * Signs in and goes back to `?redirect=`, in one step, for links that can't run the sign-in page's script (a drop that
 * won't open, raw-file errors). Someone already signed in goes straight there. Behind an auth proxy this path is
 * guarded, so by the time it runs the proxy has signed them in and 0.15.proxy-session.ts has made that Drop's session.
 * Otherwise it starts Drop's own GitHub sign-in, and where that can't start (a Drop with only email sign-in), it opens
 * the sign-in page with the same way back.
 */
export default defineHandler(async (event) => {
  const next = nextPath(event.url.searchParams.get("redirect"), event.url.origin)
  const page = `/signin?redirect=${encodeURIComponent(next)}`
  if (await identify(event)) return redirect(next, 302)
  if (authProxy().enabled) return redirect(page, 302)
  const response = await authFor(event)
    .api.signInSocial({ body: { provider: "github", callbackURL: next }, headers: event.req.headers, asResponse: true })
    .catch((error: unknown) => {
      logError(event, error, { auth: { signIn: "start failed" } })
      return null
    })
  const url = response?.ok ? ((await response.json()) as { url?: unknown }).url : undefined
  if (!response || typeof url !== "string") return redirect(page, 302)
  // The OAuth state cookie goes with the redirect, or GitHub's callback can't match it.
  for (const cookie of response.headers.getSetCookie()) event.res.headers.append("Set-Cookie", cookie)
  event.res.headers.set("Cache-Control", "private, no-store")
  return redirect(url, 302)
})
