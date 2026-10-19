import { useServerEnv } from "#vitehub/env/server"
import { githubOrganization } from "./github-membership.ts"

/** Whether sign-in is delegated to oauth2-proxy, and the cookie it sets. */
export function authProxy() {
  let env: ReturnType<typeof useServerEnv>["drop"]
  try {
    env = useServerEnv().drop
  }
  catch (error) {
    // The file-path error handler is also imported by node:test without Nitro's full env registry.
    if ((error as { code?: string }).code !== "ENV_REQUIRED_MISSING") throw error
    const values = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
    return { enabled: values.VITEHUB_DROP_AUTH_PROXY === "1" || values.DROP_AUTH_PROXY === "1", cookie: values.VITEHUB_DROP_AUTH_PROXY_COOKIE || values.DROP_AUTH_PROXY_COOKIE || null }
  }
  const { authProxy: enabled, authProxyCookie } = env
  const cookie = authProxyCookie.trim() || null
  if (enabled && !githubOrganization()) throw new Error("DROP_AUTH_PROXY requires DROP_GITHUB_ORG.")
  if (cookie && !/^[A-Za-z0-9_-]+$/.test(cookie)) throw new Error("DROP_AUTH_PROXY_COOKIE must be a cookie name.")
  return { enabled, cookie }
}
