import * as v from "valibot"
import { useServerEnv } from "#vitehub/env/server"

const ActiveMembership = v.object({ state: v.literal("active") })

/** The GitHub organization this Drop is limited to (`DROP_GITHUB_ORG`), or null when anyone may sign in. */
export const githubOrganization = () => useServerEnv().drop.githubOrg.trim() || null
const checked = new Map<string, number>()

/** A successful check lasts at most five minutes, for browser and MCP access alike. */
export async function isGitHubMember(token: string | null | undefined): Promise<boolean> {
  const organization = githubOrganization()
  if (!organization) return true
  if (!token) return false
  if ((checked.get(token) ?? 0) > Date.now()) return true
  const member = await fetch(`https://api.github.com/user/memberships/orgs/${encodeURIComponent(organization)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "Drop" },
    signal: AbortSignal.timeout(5000),
  }).then(async response => response.ok && v.is(ActiveMembership, await response.json())).catch(() => false)
  if (member) {
    // Long-lived Node servers would otherwise keep every token they ever checked.
    for (const [key, until] of checked) if (until <= Date.now()) checked.delete(key)
    checked.set(token, Date.now() + 300_000)
  }
  return member
}
