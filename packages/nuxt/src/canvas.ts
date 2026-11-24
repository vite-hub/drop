export interface CanvasPageMeta {
  params?: Record<string, string>
}

interface CanvasPage {
  path: string
  name?: string
  params?: Record<string, string>
}

interface CanvasManifest {
  pages: CanvasPage[]
}

interface ResolvedRoute {
  path: string
  name?: string
  redirect?: unknown
  _sync?: boolean
  meta?: { canvas?: false | CanvasPageMeta }
  children?: ResolvedRoute[]
}

export function canvasManifest(routes: ResolvedRoute[]): CanvasManifest {
  const pages: CanvasPage[] = []
  const visit = (route: ResolvedRoute, parent: string) => {
    if (route._sync) return
    const path = joinPath(parent, route.path)
    const children = route.children ?? []
    const hasIndex = children.some((child) => child.path === "")
    const canvas = route.meta?.canvas
    if (!hasIndex && canvas !== false && route.redirect === undefined) {
      const params = canvas?.params
      if (!path.includes("(.*)") || params) {
        const page: CanvasPage = { path }
        if (route.name) page.name = route.name
        if (params) page.params = params
        pages.push(page)
      }
    }
    for (const child of children) visit(child, path)
  }
  for (const route of routes) visit(route, "")
  return { pages }
}

function joinPath(parent: string, path: string): string {
  const joined = path.startsWith("/") ? path : `${parent.replace(/\/$/, "")}/${path}`
  return joined.replace(/\(\)(?=\/|$)/g, "").replace(/\/$/, "") || "/"
}
