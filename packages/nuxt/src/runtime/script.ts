/** What the module puts in `runtimeConfig.public.drop`. `NUXT_PUBLIC_DROP_URL` and the other `NUXT_PUBLIC_DROP_*` variables set it at runtime. */
export interface DropPublicConfig {
  /** Drop's address. Empty: the page loads no review.js. */
  url: string
  /** The edge the toolbar starts on: `top`, `right`, `bottom` or `left`. Empty: review.js's default. */
  edge: string
  /** The place along that edge, from 0 to 100. A negative value: review.js's default. */
  at: number
  /** The toolbar starts as the small mark. */
  collapsed: boolean
}

/** The src and data attributes of the review.js tag, or `undefined` when `url` is not an http(s) address. */
export function reviewScript(
  config: Partial<DropPublicConfig> | undefined,
): { src: string; data: Record<string, string> } | undefined {
  let base: URL
  try {
    base = new URL(config?.url ?? "")
  } catch {
    return undefined
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") return undefined
  if (!base.pathname.endsWith("/")) base.pathname += "/"
  const data: Record<string, string> = {}
  if (config?.edge && ["top", "right", "bottom", "left"].includes(config.edge)) data.edge = config.edge
  if (typeof config?.at === "number" && config.at >= 0 && config.at <= 100) data.at = String(config.at)
  if (config?.collapsed) data.collapsed = ""
  return { src: new URL("review.js", base).href, data }
}
