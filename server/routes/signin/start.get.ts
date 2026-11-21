import { getIP } from "better-auth/api"
import { defineHandler, redirect } from "h3"
import { useRuntimeConfig } from "nitro/runtime-config"
import * as v from "valibot"
import { requireRateLimit } from "vite-hub/rate-limit"
import { nextPath } from "#shared/sign-in"
import { authFor, identify } from "../../utils/identity"
import { logError } from "../../utils/logs"
import { authProxy } from "../../utils/proxy-auth"

/** Better Auth's answer to a social sign-in: the provider's authorize address. */
const Started = v.object({ url: v.string() })

/**
 * Signs in and goes back to `?redirect=`, in one step, for links that can't run the sign-in page's script (a drop that
 * won't open, raw-file errors). Someone already signed in goes straight there. Behind an auth proxy this path is
 * guarded, so by the time it runs the proxy has signed them in and 0.15.proxy-session.ts has made that Drop's session.
 * Otherwise it starts Drop's own GitHub sign-in (`?choose` asks GitHub for the account picker), and where that can't
 * start (a Drop with only email sign-in), it opens the sign-in page with the same way back.
 */
export default defineHandler(async (event) => {
  const next = nextPath(event.url.searchParams.get("redirect"), event.url.origin)
  const page = `/signin?redirect=${encodeURIComponent(next)}`
  if (await identify(event)) return redirect(next, 302)
  if (authProxy().enabled) return redirect(page, 302)
  // Better Auth's own limit counts requests to its routes, not this call, and each start stores an OAuth state. It counts
  // visitors the way Better Auth does, from the header server/auth.ts trusts (shared/client-ip.ts), one per IPv6 /64:
  // behind a VPS's proxy the connection's own address is the proxy's, the same for everyone. Without a header
  // (Cloudflare, Deno), the address the runtime reports.
  const { clientIpHeader } = useRuntimeConfig()
  const visitor = clientIpHeader
    ? getIP(event.req.headers, { advanced: { ipAddress: { ipAddressHeaders: [clientIpHeader] } } })
    : null
  await requireRateLimit(event, "sign-in-start", { key: visitor || undefined, limit: 10, window: "1m" })
  const choose = event.url.searchParams.has("choose")
  const response = await authFor(event)
    .api.signInSocial({
      body: {
        provider: "github",
        callbackURL: next,
        // A GitHub account that can't sign in comes back to the sign-in page, which offers the others, for this link.
        errorCallbackURL: page,
        ...(choose ? { additionalParams: { prompt: "select_account" } } : {}),
      },
      headers: event.req.headers,
      asResponse: true,
    })
    .catch((error: unknown) => {
      logError(event, error, { auth: { signIn: "start failed" } })
      return null
    })
  const started = response?.ok ? v.safeParse(Started, await response.json().catch(() => null)) : null
  if (!response || !started?.success) return redirect(page, 302)
  // The OAuth state cookie goes with the redirect, or GitHub's callback can't match it.
  for (const cookie of response.headers.getSetCookie()) event.res.headers.append("Set-Cookie", cookie)
  event.res.headers.set("Cache-Control", "private, no-store")
  return redirect(started.output.url, 302)
})
