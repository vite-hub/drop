export interface DropPublicConfig {
  url: string
  edge: string
  at: number
  collapsed: boolean
}

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
  if (config?.at !== undefined && config.at >= 0 && config.at <= 100) data.at = String(config.at)
  if (config?.collapsed) data.collapsed = ""
  return { src: new URL("review.js", base).href, data }
}
