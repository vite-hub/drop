export const HOSTS = ["cloudflare", "vercel", "netlify", "deno", "vps"] as const
export type Host = typeof HOSTS[number]

/** Build-time choices. Credentials and the SQLite path remain runtime settings. */
export function deployment(env: Record<string, string | undefined> = process.env) {
  const presets: Record<string, Host> = {
    cloudflare: "cloudflare", cloudflare_module: "cloudflare",
    vercel: "vercel", netlify: "netlify", deno: "deno", deno_server: "deno",
    node: "vps", node_server: "vps",
  }
  const preset = env.NITRO_PRESET || env.SERVER_PRESET
  const host = env.DROP_HOST || (preset ? presets[preset.replaceAll("-", "_")] : undefined)
    || (env.VERCEL === "1" ? "vercel" : env.NETLIFY === "true" ? "netlify" : env.DENO_DEPLOYMENT_ID ? "deno" : undefined)
    || (env.DROP_DATABASE_URL ? "vps" : "cloudflare")
  if (!HOSTS.includes(host as Host)) throw new Error(`DROP_HOST must be one of ${HOSTS.join(", ")}; got "${host}".`)
  if (preset && !presets[preset.replaceAll("-", "_")]) throw new Error(`Unsupported Drop preset "${preset}". Set DROP_HOST and use its matching Nitro preset.`)
  if (preset && presets[preset.replaceAll("-", "_")] !== host) throw new Error(`DROP_HOST=${host} conflicts with ${preset}.`)

  // Preserve existing VPS deployments with an explicit D1 database. Never switch a configured D1 to SQLite.
  const database = env.DROP_DATABASE || (env.DROP_DATABASE_URL ? "sqlite" : host === "vps" && !env.CLOUDFLARE_D1_DATABASE_ID ? "sqlite" : "d1")
  if (database !== "sqlite" && database !== "d1") throw new Error("DROP_DATABASE must be sqlite or d1.")
  if (database === "sqlite" && host !== "vps") throw new Error("Local SQLite needs DROP_HOST=vps and persistent disk.")
  if (database === "d1" && env.DROP_DATABASE_URL) throw new Error("DROP_DATABASE_URL cannot be used with DROP_DATABASE=d1.")
  if (env.DROP_DATABASE_URL && !env.DROP_DATABASE_URL.startsWith("file:")) throw new Error("DROP_DATABASE_URL must be a local file: URL.")
  return { host: host as Host, database }
}
