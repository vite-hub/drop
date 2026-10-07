// The docs' sidebar, page order, and the hosts Drop deploys to (nuxt.config.ts reads DROP_HOST at build time).
export interface DocsLink {
  label: string
  to: string
  icon?: string
}

export type HostId = "cloudflare" | "vercel" | "netlify" | "deno" | "vps"

export interface Host {
  id: HostId
  name: string
  icon: string
  /** A Drop running on this host, built from this repository. */
  live?: string
  database: string
  files: string
  rateLimits: string
  codeImages: string
  cleanup: string
}

export const HOSTS: Host[] = [
  { id: "cloudflare", name: "Cloudflare", icon: "i-simple-icons-cloudflare", live: "https://drop.vitehub.dev", database: "D1", files: "R2", rateLimits: "Workers rate limiting", codeImages: "PNG and SVG", cleanup: "Cron trigger" },
  { id: "vercel", name: "Vercel", icon: "i-simple-icons-vercel", database: "Turso (libSQL)", files: "Vercel Blob", rateLimits: "Per instance", codeImages: "SVG", cleanup: "Vercel Cron Job" },
  { id: "netlify", name: "Netlify", icon: "i-simple-icons-netlify", live: "https://vitehub-drop.netlify.app", database: "Turso (libSQL)", files: "Netlify Blobs", rateLimits: "Per instance", codeImages: "SVG", cleanup: "Scheduled function" },
  { id: "deno", name: "Deno Deploy", icon: "i-simple-icons-deno", database: "Turso (libSQL)", files: "S3-compatible bucket", rateLimits: "Per instance", codeImages: "SVG", cleanup: "None" },
  { id: "vps", name: "VPS", icon: "i-lucide-server", database: "SQLite file", files: "Local disk", rateLimits: "In memory", codeImages: "SVG", cleanup: "In process" },
]

export const hostById = (id: HostId) => HOSTS.find(host => host.id === id)!

export const DOCS_NAV: Array<{ title: string; links: DocsLink[] }> = [
  {
    title: "Use Drop",
    links: [
      { label: "Introduction", to: "/docs" },
      { label: "Connect an agent", to: "/docs/agents" },
      { label: "Review and share", to: "/docs/review" },
    ],
  },
  {
    title: "Self-host",
    links: [
      { label: "Overview", to: "/docs/self-host" },
      ...HOSTS.map(host => ({ label: host.name, to: `/docs/self-host/${host.id}`, icon: host.icon })),
    ],
  },
]

export const DOCS_PAGES = DOCS_NAV.flatMap(group => group.links)
