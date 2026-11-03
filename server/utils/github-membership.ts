import * as v from "valibot"
import { HTTPError } from "h3"
import { useServerEnv } from "#vitehub/env/server"

const Membership = v.object({ state: v.picklist(["active", "pending"]) })

/** The GitHub organization this Drop is limited to (`DROP_GITHUB_ORG`), or null when anyone may sign in. */
export const githubOrganization = () => useServerEnv().drop.githubOrg.trim() || null
// doctor-disable-next-line nitro/cache/no-module-scope-response-cache -- keys are OAuth bearer tokens; keep this pruned five-minute grant cache in memory, never in shared cache storage.
const checked = new Map<string, { organization: string; until: number }>()

const unavailable = (githubStatus?: number) =>
  new HTTPError({
    status: 503,
    statusText: "GitHub membership verification is unavailable. Try again shortly.",
    data: { code: "GITHUB_MEMBERSHIP_UNAVAILABLE", githubStatus },
  })

/** A successful check lasts at most five minutes, for browser and MCP access alike. */
export async function isGitHubMember(token: string | null | undefined): Promise<boolean> {
  const organization = githubOrganization()
  if (!organization) return true
  if (!token) return false
  const cached = checked.get(token)
  if (cached?.organization === organization && cached.until > Date.now()) return true
  const response = await fetch(`https://api.github.com/user/memberships/orgs/${encodeURIComponent(organization)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "Drop" },
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    throw unavailable()
  })
  if (response.status === 401)
    throw new HTTPError({
      status: 401,
      statusText: "GitHub sign-in expired or was revoked. Sign in again to Drop.",
      data: { code: "GITHUB_REAUTH_REQUIRED", githubStatus: response.status },
    })
  if (
    response.status === 429 ||
    response.status >= 500 ||
    (!response.ok && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")))
  )
    throw unavailable(response.status)
  const scopes = response.headers.get("x-oauth-scopes")?.split(/[,\s]+/)
  if (
    response.status === 403 ||
    (scopes && !scopes.some((scope) => ["read:org", "write:org", "admin:org"].includes(scope)))
  )
    throw new HTTPError({
      status: 403,
      statusText:
        "GitHub organization access could not be verified. Reauthorize Drop with read:org and any required organization SSO access.",
      data: { code: "GITHUB_ORG_ACCESS_REQUIRED", githubStatus: response.status },
    })
  if (response.status === 404) return false
  if (!response.ok) throw unavailable(response.status)
  const body: unknown = await response.json().catch(() => {
    throw unavailable(response.status)
  })
  const membership = v.safeParse(Membership, body)
  if (!membership.success) throw unavailable(response.status)
  const member = membership.output.state === "active"
  if (member) {
    // Long-lived Node servers would otherwise keep every token they ever checked.
    for (const [key, value] of checked) if (value.until <= Date.now()) checked.delete(key)
    checked.set(token, { organization, until: Date.now() + 300_000 })
  }
  return member
}
