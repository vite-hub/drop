export const CLIENT_IP_HEADERS: Readonly<Record<string, string>> = {
  vercel: "x-vercel-forwarded-for",
  netlify: "x-nf-client-connection-ip",
  vps: "x-forwarded-for",
}
