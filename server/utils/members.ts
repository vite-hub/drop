import { type H3Event, HTTPError } from "h3"
import { checkAuthMember } from "vite-hub/auth/server"
import { useServerEnv } from "vite-hub/env"
import * as v from "valibot"

/** Whether `VITEHUB_MEMBERS` limits who may use this Drop. */
export const membersOnly = () => Boolean(useServerEnv().drop.members?.unseal().trim())

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

const membershipOutageCode = "AUTH_GITHUB_UNAVAILABLE"
const MembershipOutage = v.object({ body: v.object({ code: v.literal(membershipOutageCode) }) })
const WrappedMembershipOutage = v.object({
  code: v.literal("AUTH_PROVIDER_OPERATION_FAILED"),
  cause: MembershipOutage,
})

/** Session policy errors cross Better Auth's API boundary before the sessionless check can run. */
export function rethrowMembershipOutage(error: unknown) {
  if (!v.is(MembershipOutage, error) && !v.is(WrappedMembershipOutage, error)) return
  throw new HTTPError({
    status: 503,
    statusText: "GitHub membership verification is unavailable. Try again shortly.",
    data: { code: membershipOutageCode },
  })
}
