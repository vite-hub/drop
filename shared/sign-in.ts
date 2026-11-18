/**
 * Where sign-in goes back to: a same-site path from `?redirect=`, never a full URL, else the drops list. `origin` is
 * this Drop's own.
 */
export function nextPath(value: string | null | undefined, origin: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/drops"
  try {
    const resolved = new URL(value, origin)
    if (resolved.origin !== origin) return "/drops"
    return `${resolved.pathname}${resolved.search}${resolved.hash}`
  } catch {
    return "/drops"
  }
}

/**
 * Signs in and comes back to `path` in one step (server/routes/signin/start.get.ts). Behind an auth proxy it is a path
 * the proxy guards, so its session turns into Drop's before the redirect; `/d/` links are open to everyone and never
 * would.
 */
export const signInPath = (path: string) => `/signin/start?redirect=${encodeURIComponent(path)}`

/**
 * Set while someone is signed in on this browser (the dashboard layout), cleared when they sign out (useSignOut). It
 * names nobody; it only says that a drop this browser can't open may open after signing in again.
 */
export const RETURNING_COOKIE = "drop-returning"
/** Set for a minute when a drop sends this browser to sign in by itself, so a sign-in that doesn't help can't loop. */
export const TRIED_COOKIE = "drop-signin-tried"

/**
 * Whether a drop that won't open sends this browser straight to sign-in instead of showing why. Only a signed-out
 * browser that was signed in before, once a minute, and only for the answers a private, team or deleted drop gives
 * (all the same 404), so it says nothing about which one this is.
 */
export const signInRightAway = (status: number, cookies: { returning: boolean; tried: boolean }) =>
  status === 404 && cookies.returning && !cookies.tried
