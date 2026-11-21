import { HTTPError } from "h3"
import { checkGitHubOrgMember } from "vite-hub/auth"
import { useServerEnv } from "vite-hub/env"

const proxyOrganization = () =>
  useServerEnv()
    .drop.members?.unseal()
    .split(",")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("github-org:"))
    ?.slice("github-org:".length) || null

export function readAuthProxyConfig() {
  const { authProxy: enabled, authProxyCookie } = useServerEnv().drop
  const cookie = authProxyCookie.trim() || null
  if (enabled && !proxyOrganization())
    throw new Error("DROP_AUTH_PROXY requires a github-org:<organization> entry in VITEHUB_MEMBERS.")
  if (cookie && !/^[A-Za-z0-9_-]+$/.test(cookie)) throw new Error("DROP_AUTH_PROXY_COOKIE must be a cookie name.")
  return { enabled, cookie }
}

export async function isProxyMember(token: string): Promise<boolean> {
  const organization = proxyOrganization()
  if (!organization) return false
  const [error] = await checkGitHubOrgMember(token, organization, { cacheMs: 300_000 })
  if (!error) return true
  if (error.code === "AUTH_GITHUB_NOT_ORG_MEMBER") return false
  if (error.code === "AUTH_GITHUB_TOKEN_INVALID")
    throw new HTTPError({
      status: 401,
      statusText: "GitHub sign-in expired or was revoked. Sign in again to Drop.",
      data: { code: "GITHUB_REAUTH_REQUIRED" },
    })
  if (error.code === "AUTH_GITHUB_ORG_ACCESS_DENIED")
    throw new HTTPError({
      status: 403,
      statusText:
        "GitHub organization access could not be verified. Reauthorize Drop with read:org and any required organization SSO access.",
      data: { code: "GITHUB_ORG_ACCESS_REQUIRED" },
    })
  throw new HTTPError({
    status: 503,
    statusText: "GitHub membership verification is unavailable. Try again shortly.",
    data: { code: "GITHUB_MEMBERSHIP_UNAVAILABLE" },
  })
}
