import { createHmac } from "node:crypto"

/** The part of ViteHub Server Env this reads, so it also takes the env Better Auth's definition receives. */
type SecretSource = { secret?: { unseal: () => string }; auth?: { secret?: { unseal: () => string } } }

/**
 * Drop's one secret, `VITEHUB_SECRET`, and every key derived from it. Each use gets its own key, an HMAC of the root
 * under a purpose label, so a key that leaks says nothing about the root or the others. Deployments from before it
 * existed have only `BETTER_AUTH_SECRET`, which then serves as the root.
 */
function rootSecret(env: SecretSource): string {
  const root = env.secret?.unseal() || env.auth?.secret?.unseal()
  if (!root) throw new Error("Set VITEHUB_SECRET (openssl rand -base64 32). Drop derives every key it needs from it.")
  return root
}

/** The key for `purpose`, base64url. Stable for a given root and purpose. */
export function deriveSecret(env: SecretSource, purpose: string): string {
  return createHmac("sha256", rootSecret(env)).update(`drop:${purpose}`).digest("base64url")
}

/**
 * Better Auth's secret: `BETTER_AUTH_SECRET` when set, so sessions, agent tokens, and the signing keys Better Auth
 * stores encrypted with it survive adding `VITEHUB_SECRET`; otherwise derived from the root.
 */
export function authSecret(env: SecretSource): string {
  return env.auth?.secret?.unseal() || deriveSecret(env, "auth")
}
