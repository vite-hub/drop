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

const routeParam = /(?<!\\):([\w]+)(?:\(((?:\\.|[^\\)])*)\))?([?*+])?/g

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
      if (
        [...path.matchAll(routeParam)].every(([, name, pattern]) => {
          return (pattern !== ".*" && pattern !== "[^/]*") || Boolean(params?.[name])
        })
      ) {
        const page: CanvasPage = {
          path: path.replace(routeParam, (token, name, pattern, modifier, offset) => {
            return pattern === "" && (path[offset + token.length] === "/" || offset + token.length === path.length)
              ? `:${name}${modifier ?? ""}`
              : token
          }),
        }
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
  return joined.replace(/\/$/, "") || "/"
}

function encodeLiteral(text: string): string {
  return encodeURI(text.replace(/\\(.)/g, "$1")).replace(/[?#]/g, encodeURIComponent)
}

export function canvasPageURL({ path, params }: CanvasPage): string | undefined {
  let url = ""
  let offset = 0
  for (const match of path.matchAll(routeParam)) {
    const [token, name] = match
    const value = params?.[name]
    if (!value) return
    url += encodeLiteral(path.slice(offset, match.index)) + encodeURIComponent(value)
    offset = match.index + token.length
  }
  return url + encodeLiteral(path.slice(offset))
}

export function routeRuleRedirects(rules: Record<string, { redirect?: unknown }>, path: string): boolean {
  const segments = path.replace(/\/$/, "").split("/")
  return Object.entries(rules).some(([pattern, rule]) => {
    if (!rule.redirect) return false
    const match = pattern.replace(/\/$/, "").split("/")
    return (
      match.every((segment, index) => {
        if (segment === "**") return true
        if (segment === "*" || segment.startsWith(":")) return Boolean(segments[index])
        return segment === segments[index]
      }) &&
      (match.at(-1) === "**" || match.length === segments.length)
    )
  })
}
