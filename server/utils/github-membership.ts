import * as v from "valibot"
import { useServerEnv } from "#vitehub/env/server"

const ActiveMembership = v.object({ state: v.literal("active") })
const GitHubUser = v.object({ login: v.string() })

/** The GitHub organization this Drop is limited to (`DROP_GITHUB_ORG`), or null when anyone may sign in. */
export const githubOrganization = () => useServerEnv().drop.githubOrg.trim() || null

/** The GitHub logins this Drop is limited to (`DROP_GITHUB_USERS`), lowercased, or null when the list is empty. */
function githubUsers() {
  const logins = useServerEnv()
    .drop.githubUsers.split(/[\s,]+/)
    .filter(Boolean)
    .map((login) => login.toLowerCase())
  return logins.length ? new Set(logins) : null
}

/** Whether only some GitHub accounts may use this Drop: `DROP_GITHUB_ORG`'s members, `DROP_GITHUB_USERS`, or both. */
export const membersOnly = () => Boolean(githubOrganization() || githubUsers())

const checked = new Map<string, number>()

const github = (token: string, path: string) =>
  fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "Drop" },
    signal: AbortSignal.timeout(5000),
  })

/**
 * Whether the token's GitHub account may use this Drop: it's in `DROP_GITHUB_USERS` or an active member of
 * `DROP_GITHUB_ORG`. A successful check lasts at most five minutes, for browser and MCP access alike.
 */
export async function isGitHubMember(token: string | null | undefined): Promise<boolean> {
  if (!membersOnly()) return true
  if (!token) return false
  if ((checked.get(token) ?? 0) > Date.now()) return true
  const users = githubUsers()
  const organization = githubOrganization()
  const listed = async () => {
    if (!users) return false
    const response = await github(token, "/user")
    const profile = response.ok ? v.safeParse(GitHubUser, await response.json()) : null
    return Boolean(profile?.success && users.has(profile.output.login.toLowerCase()))
  }
  const inOrganization = async () => {
    if (!organization) return false
    const response = await github(token, `/user/memberships/orgs/${encodeURIComponent(organization)}`)
    return response.ok && v.is(ActiveMembership, await response.json())
  }
  const member = await listed()
    .then(async (found) => found || (await inOrganization()))
    .catch(() => false)
  if (member) {
    // Long-lived Node servers would otherwise keep every token they ever checked.
    for (const [key, until] of checked) if (until <= Date.now()) checked.delete(key)
    checked.set(token, Date.now() + 300_000)
  }
  return member
}
