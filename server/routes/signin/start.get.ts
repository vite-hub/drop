import { getIP } from "better-auth/api"
import { defineHandler, redirect } from "h3"
import { useRuntimeConfig } from "nitro/runtime-config"
import * as v from "valibot"
import { requireRateLimit } from "vite-hub/rate-limit"
import { nextPath, signInVia } from "#shared/sign-in"
import { authFor, identify } from "../../utils/identity"
import { logError, requestLog } from "../../utils/logs"
import { authProxy } from "../../utils/proxy-auth"
import { markSignInAttempt } from "../../utils/sign-in-attempt"

const Started = v.object({ url: v.string() })

export default defineHandler(async (event) => {
  const next = nextPath(event.url.searchParams.get("redirect"), event.url.origin)
  const page = `/signin?redirect=${encodeURIComponent(next)}`
  if (await identify(event)) return redirect(next, 302)
  if (authProxy().enabled) return redirect(page, 302)
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
  if (!response) return redirect(page, 302)
  const started = response.ok ? v.safeParse(Started, await response.json().catch(() => null)) : null
  if (!started?.success) {
    requestLog(event)?.warn("GitHub sign-in did not start", {
      auth: { signIn: "start failed", status: response.status },
    })
    return redirect(page, 302)
  }
  for (const cookie of response.headers.getSetCookie()) event.res.headers.append("Set-Cookie", cookie)
  const via = signInVia(event.url.searchParams.get("via"))
  if (via) markSignInAttempt(event, via)
  event.res.headers.set("Cache-Control", "private, no-store")
  return redirect(started.output.url, 302)
})
