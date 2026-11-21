import { getIP } from "better-auth/api"
import { defineHandler, redirect } from "h3"
import * as v from "valibot"
import { requireRateLimit } from "vite-hub/rate-limit"
import { nextPath } from "#shared/sign-in"
import { clientAddress } from "../../utils/client-address"
import { authFor, identify } from "../../utils/identity"
import { logError } from "../../utils/logs"
import { authProxy } from "../../utils/proxy-auth"

const Started = v.object({ url: v.string() })

export default defineHandler(async (event) => {
  const next = nextPath(event.url.searchParams.get("redirect"), event.url.origin)
  const page = `/signin?redirect=${encodeURIComponent(next)}`
  if (await identify(event)) return redirect(next, 302)
  if (authProxy().enabled) return redirect(page, 302)
  const address = clientAddress(event)
  const key = address
    ? getIP(new Headers({ "x-forwarded-for": address }), {
        advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"], ipv6Subnet: 64 } },
      })
    : null
  await requireRateLimit(event, "sign-in-start", { key: key ?? undefined, limit: 10, window: "1m" })
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
  const started = response?.ok ? v.safeParse(Started, await response.json().catch(() => null)) : null
  if (!response || !started?.success) return redirect(page, 302)
  for (const cookie of response.headers.getSetCookie()) event.res.headers.append("Set-Cookie", cookie)
  event.res.headers.set("Cache-Control", "private, no-store")
  return redirect(started.output.url, 302)
})
