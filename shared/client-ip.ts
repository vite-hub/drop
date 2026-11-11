// Platform headers are overwritten by their ingress. VPS proxies must overwrite X-Forwarded-For (self-host/vps docs).
// Deno's header is internal: 0.0.client-ip middleware replaces it with the runtime's connection address.
export const CLIENT_IP_HEADERS = {
  cloudflare: "cf-connecting-ip",
  vercel: "x-vercel-forwarded-for",
  netlify: "x-nf-client-connection-ip",
  deno: "x-drop-client-ip",
  vps: "x-forwarded-for",
} as const
