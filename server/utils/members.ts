import { type H3Event, HTTPError } from "h3"
import { checkAuthMember } from "vite-hub/auth/server"
import { useServerEnv } from "vite-hub/env"

/** Whether `VITEHUB_MEMBERS` limits who may use this Drop. */
export const membersOnly = () => Boolean(useServerEnv().drop.members.unseal().trim())

/**
 * Whether someone may still use this Drop, by ViteHub Auth's `VITEHUB_MEMBERS` rules: a listed account, a verified
 * email or domain, an admin, or an active member of a listed GitHub organization. Sign-in and every session check it
 * already; this is for what carries a person but no session (upload tickets, review tokens, presence, mentions).
 */
export async function isMember(userId: string, event?: H3Event | Request) {
  const [error] = await checkAuthMember(userId, event)
  if (error?.code === "AUTH_GITHUB_UNAVAILABLE")
    throw new HTTPError({
      status: 503,
      statusText: "GitHub membership verification is unavailable. Try again shortly.",
      data: { code: error.code },
    })
  return !error
}

/** Session policy errors cross Better Auth's API boundary before the sessionless check can run. */
export function rethrowMembershipOutage(error: unknown) {
  if (!error || typeof error !== "object" || !("body" in error)) return
  const body = error.body
  if (body && typeof body === "object" && "code" in body && body.code === "AUTH_GITHUB_UNAVAILABLE")
    throw new HTTPError({
      status: 503,
      statusText: "GitHub membership verification is unavailable. Try again shortly.",
      data: { code: body.code },
    })
}
