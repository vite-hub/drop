export function nextPath(value: string | null | undefined, origin: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/drops"
  try {
    const resolved = new URL(value, origin)
    const path = `${resolved.pathname}${resolved.search}${resolved.hash}`
    return resolved.origin === origin && !path.startsWith("//") ? path : "/drops"
  } catch {
    return "/drops"
  }
}

export function signInPath(path: string, { proxy = false, choose = false } = {}) {
  const start = `/signin/start?redirect=${encodeURIComponent(path)}${choose && !proxy ? "&choose=1" : ""}`
  return proxy ? `/oauth2/start?rd=${encodeURIComponent(start)}` : start
}

export const RETURNING_COOKIE = "drop-returning"
export const TRIED_COOKIE = "drop-signin-tried"

export const signInRightAway = (status: number, cookies: { returning: boolean; tried: boolean }) =>
  status === 404 && cookies.returning && !cookies.tried
