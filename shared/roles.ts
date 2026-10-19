// Two roles on Better Auth's admin plugin (role field + createAccessControl). Everyone who signs in joins as a Member;
// the people whose verified emails are in DROP_ADMINS are Admins, whatever they sign in with.
export type Role = "admin" | "member"

export const ROLES: Role[] = ["admin", "member"]
export const DEFAULT_ROLE: Role = "member"

export const ROLE_LABELS: Record<Role, string> = { admin: "Admin", member: "Member" }

export const ROLE_SUMMARY: Record<Role, string> = {
  admin: "Everything, plus members, settings, and the team's folders.",
  member: "Create, share, and comment on drops, and add to the team's folders.",
}

export const isRole = (value: string): value is Role => ROLES.some((role) => role === value)

/** The admins `DROP_ADMINS` names: emails, comma- or space-separated, compared without case. */
const adminEmails = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)

/**
 * Someone's role: admin when `admins` (DROP_ADMINS) has their email and a sign-in method verified it. `trustUnverified`
 * is for `nuxt dev` and the runtime tests, where email sign-in verifies nothing.
 */
export function roleFor(
  person: { email: string; emailVerified?: boolean | null },
  admins: string,
  trustUnverified = false,
): Role {
  const verified = Boolean(person.emailVerified) || trustUnverified
  return verified && adminEmails(admins).includes(person.email.trim().toLowerCase()) ? "admin" : "member"
}
