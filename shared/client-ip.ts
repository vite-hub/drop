export const CLIENT_IP_HEADERS: Readonly<Record<string, string>> = {
  vercel: "x-vercel-forwarded-for",
  netlify: "x-nf-client-connection-ip",
  vps: "x-forwarded-for",
}

export const VIEWER_IP_HEADERS: Readonly<Record<string, string>> = { ...CLIENT_IP_HEADERS, deno: "x-forwarded-for" }

export function forwardedAddress(headers: Headers, header: string): string | undefined {
  if (!header) return undefined
  return headers
    .get(header)
    ?.split(",")
    .map((value) => value.trim())
    .findLast(Boolean)
}
