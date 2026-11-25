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

const SIGN_IN_VIAS = ["button", "card", "auto"] as const
export type SignInVia = (typeof SIGN_IN_VIAS)[number]
export const signInVia = (value: string | null | undefined) => SIGN_IN_VIAS.find((via) => via === value)

export function signInPath(
  path: string,
  { proxy = false, choose = false, via }: { proxy?: boolean; choose?: boolean; via?: SignInVia } = {},
) {
  const start = `/signin/start?redirect=${encodeURIComponent(path)}${choose && !proxy ? "&choose=1" : ""}${via ? `&via=${via}` : ""}`
  return proxy ? `/oauth2/start?rd=${encodeURIComponent(start)}` : start
}

export const RETURNING_COOKIE = "drop-returning"
export const TRIED_COOKIE = "drop-signin-tried"
export const ATTEMPT_COOKIE = "drop-signin-attempt"
export const PROXY_SIGN_OUT_HANDOFF_HEADER = "x-drop-proxy-sign-out-handoff"

export const signInRightAway = (status: number, cookies: { returning: boolean; tried: boolean }) =>
  status === 404 && cookies.returning && !cookies.tried
