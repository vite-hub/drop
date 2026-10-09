export const githubOrganization = process.env.DROP_GITHUB_ORG?.trim()
const checked = new Map<string, number>()

/** A successful check lasts at most five minutes, for browser and MCP access alike. */
export async function isGitHubMember(token: string | null | undefined): Promise<boolean> {
  if (!githubOrganization) return true
  if (!token) return false
  if ((checked.get(token) ?? 0) > Date.now()) return true
  const member = await fetch(`https://api.github.com/user/memberships/orgs/${encodeURIComponent(githubOrganization)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "Quiver-Drop" },
    signal: AbortSignal.timeout(5000),
  }).then(async response => response.ok && (await response.json() as { state?: string }).state === "active").catch(() => false)
  if (member) checked.set(token, Date.now() + 300_000)
  return member
}
