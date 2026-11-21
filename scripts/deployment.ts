import { detectHost } from "vite-hub"

export const HOSTS = ["cloudflare", "vercel", "netlify", "deno", "vps"] as const
export type HostId = (typeof HOSTS)[number]
export type Host = HostId

export function deployment(env: Record<string, string | undefined> = process.env) {
  const explicit = detectHost({ VITEHUB_HOST: env.VITEHUB_HOST })
  const legacy = env.DROP_HOST
  if (!explicit && legacy && !HOSTS.some((host) => host === legacy))
    throw new Error(`DROP_HOST must be one of ${HOSTS.join(", ")}; migrate to VITEHUB_HOST (node for VPS).`)
  const detected = explicit ?? detectHost(legacy ? { ...env, VITEHUB_HOST: legacy === "vps" ? "node" : legacy } : env)
  const host: Host = detected === "node" ? "vps" : (detected ?? (env.DROP_DATABASE_URL ? "vps" : "cloudflare"))

  const database =
    env.DROP_DATABASE ||
    (env.DROP_DATABASE_URL ? "sqlite" : host === "vps" && !env.CLOUDFLARE_D1_DATABASE_ID ? "sqlite" : "d1")
  if (database !== "sqlite" && database !== "d1") throw new Error("DROP_DATABASE must be sqlite or d1.")
  if (database === "sqlite" && host !== "vps")
    throw new Error("Local SQLite needs VITEHUB_HOST=node and persistent disk.")
  if (database === "d1" && env.DROP_DATABASE_URL)
    throw new Error("DROP_DATABASE_URL cannot be used with DROP_DATABASE=d1.")
  if (env.DROP_DATABASE_URL && !env.DROP_DATABASE_URL.startsWith("file:"))
    throw new Error("DROP_DATABASE_URL must be a local file: URL.")
  return { host, database }
}
