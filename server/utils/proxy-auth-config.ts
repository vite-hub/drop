import { useServerEnv } from "#vitehub/env/server"
import { githubOrganization } from "./github-membership.ts"

/** Whether sign-in is delegated to oauth2-proxy, and the cookie it sets. */
export function readAuthProxyConfig() {
  const { authProxy: enabled, authProxyCookie } = useServerEnv().drop
  const cookie = authProxyCookie.trim() || null
  if (enabled && !githubOrganization()) throw new Error("DROP_AUTH_PROXY requires DROP_GITHUB_ORG.")
  if (cookie && !/^[A-Za-z0-9_-]+$/.test(cookie)) throw new Error("DROP_AUTH_PROXY_COOKIE must be a cookie name.")
  return { enabled, cookie }
}
