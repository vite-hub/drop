export type Role = "admin" | "member"

export const ROLES: Role[] = ["admin", "member"]

export const ROLE_LABELS: Record<Role, string> = { admin: "Admin", member: "Member" }

export const ROLE_SUMMARY: Record<Role, string> = {
  admin: "Everything, plus members, settings, and the team's folders.",
  member: "Create, share, and comment on drops, and add to the team's folders.",
}

export const isRole = (value: string): value is Role => ROLES.some((role) => role === value)

const emails = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)

export function isListed(
  person: { email: string; emailVerified?: boolean | null },
  list: string,
  trustUnverified = false,
) {
  const verified = Boolean(person.emailVerified) || trustUnverified
  return verified && emails(list).includes(person.email.trim().toLowerCase())
}

export function roleFor(
  person: { email: string; emailVerified?: boolean | null },
  admins: string,
  trustUnverified = false,
): Role {
  return isListed(person, admins, trustUnverified) ? "admin" : "member"
}
