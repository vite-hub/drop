import type { H3Event } from "h3"
import { checkAuthMember } from "vite-hub/auth/server"
import { useServerEnv } from "vite-hub/env"
import * as v from "valibot"
import { authError } from "./auth-errors"

export const membersOnly = () => Boolean(useServerEnv().drop.members?.unseal().trim())

export async function isMember(userId: string, event?: H3Event | Request) {
  const [error] = await checkAuthMember(userId, event)
  if (error?.code === "AUTH_GITHUB_UNAVAILABLE") throw authError("AUTH_GITHUB_UNAVAILABLE")
  return !error
}

const MembershipOutage = v.object({ body: v.object({ code: v.literal("AUTH_GITHUB_UNAVAILABLE") }) })
const WrappedMembershipOutage = v.object({
  code: v.literal("AUTH_PROVIDER_OPERATION_FAILED"),
  cause: MembershipOutage,
})

export function isMembershipOutage(error: unknown) {
  return v.is(MembershipOutage, error) || v.is(WrappedMembershipOutage, error)
}

export function rethrowMembershipOutage(error: unknown) {
  if (isMembershipOutage(error)) throw authError("AUTH_GITHUB_UNAVAILABLE")
}
