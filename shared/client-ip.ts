// Platform headers are overwritten by their ingress. VPS proxies must overwrite X-Forwarded-For (self-host/vps docs).
// Cloudflare and Deno have none here: ViteHub Auth gives Better Auth the address the runtime reports (cf-connecting-ip,
// Deno's connection address) and drops any copy a caller sends.
export const CLIENT_IP_HEADERS: Readonly<Record<string, string>> = {
  vercel: "x-vercel-forwarded-for",
  netlify: "x-nf-client-connection-ip",
  vps: "x-forwarded-for",
}
