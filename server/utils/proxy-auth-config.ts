import * as v from "valibot"
import { useServerEnv } from "#vitehub/env/server"
import { githubOrganization } from "./github-membership.ts"

const MissingEnv = v.object({ code: v.literal("ENV_REQUIRED_MISSING") })
// Workers have no `process` unless nodejs_compat adds one.
const ProcessEnv = v.object({ process: v.optional(v.object({ env: v.optional(v.record(v.string(), v.optional(v.string()))) })) })

/** Whether sign-in is delegated to oauth2-proxy, and the cookie it sets. */
export function readAuthProxyConfig() {
  let env: ReturnType<typeof useServerEnv>["drop"]
  try {
    env = useServerEnv().drop
  }
  catch (error) {
    // The file-path error handler is also imported by node:test without Nitro's full env registry.
    if (!v.is(MissingEnv, error)) throw error
    const found = v.safeParse(ProcessEnv, globalThis)
    const values = (found.success ? found.output.process?.env : undefined) ?? {}
    return { enabled: values.VITEHUB_DROP_AUTH_PROXY === "1" || values.DROP_AUTH_PROXY === "1", cookie: values.VITEHUB_DROP_AUTH_PROXY_COOKIE || values.DROP_AUTH_PROXY_COOKIE || null }
  }
  const { authProxy: enabled, authProxyCookie } = env
  const cookie = authProxyCookie.trim() || null
  if (enabled && !githubOrganization()) throw new Error("DROP_AUTH_PROXY requires DROP_GITHUB_ORG.")
  if (cookie && !/^[A-Za-z0-9_-]+$/.test(cookie)) throw new Error("DROP_AUTH_PROXY_COOKIE must be a cookie name.")
  return { enabled, cookie }
}
