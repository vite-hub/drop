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
  /** The hosted instance, when available. */
  live?: string
  database: string
  files: string
  rateLimits: string
  codeImages: string
  cleanup: string
}

export const HOSTS: Host[] = [
  { id: "cloudflare", name: "Cloudflare", icon: "i-simple-icons-cloudflare", live: "https://drop.vitehub.dev", database: "D1", files: "R2", rateLimits: "Workers rate limiting", codeImages: "PNG and SVG", cleanup: "Cron trigger" },
  { id: "vercel", name: "Vercel", icon: "i-simple-icons-vercel", database: "D1 over HTTP", files: "Vercel Blob", rateLimits: "Per instance", codeImages: "SVG", cleanup: "Vercel Cron Job" },
  { id: "netlify", name: "Netlify", icon: "i-simple-icons-netlify", database: "D1 over HTTP", files: "Netlify Blobs", rateLimits: "Per instance", codeImages: "SVG", cleanup: "Scheduled function" },
  { id: "deno", name: "Deno Deploy", icon: "i-simple-icons-deno", database: "D1 over HTTP", files: "R2 S3 API", rateLimits: "Per instance", codeImages: "SVG", cleanup: "None" },
  { id: "vps", name: "VPS", icon: "i-lucide-server", database: "D1 over HTTP", files: "Local disk", rateLimits: "In memory", codeImages: "SVG", cleanup: "In process" },
]

// Official clone flows. Deno reads its build and runtime settings from deno.jsonc.
export const DEPLOY_URLS: Record<HostId, string> = {
  cloudflare: "https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fvite-hub%2Fdrop",
  vercel: "https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvite-hub%2Fdrop&env=GITHUB_CLIENT_ID%2CGITHUB_CLIENT_SECRET%2CBETTER_AUTH_SECRET%2CDROP_ADMINS%2CCLOUDFLARE_ACCOUNT_ID%2CCLOUDFLARE_API_TOKEN%2CCLOUDFLARE_D1_DATABASE_ID%2CCLOUDFLARE_D1_DATABASE_NAME&envDescription=GitHub+sign-in%2C+admin+user+IDs%2C+Cloudflare+D1%2C+and+a+private+Blob+store.+See+the+Drop+guide+for+each+value.&envLink=https%3A%2F%2Fdrop.vitehub.dev%2Fdocs%2Fself-host%2Fvercel&stores=%5B%7B%22type%22%3A%22blob%22%7D%5D",
  netlify: "https://app.netlify.com/start/deploy?repository=https%3A%2F%2Fgithub.com%2Fvite-hub%2Fdrop",
  deno: "https://console.deno.com/new?clone=https%3A%2F%2Fgithub.com%2Fvite-hub%2Fdrop",
  vps: "https://drop.vitehub.dev/docs/self-host/vps#steps",
}

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
