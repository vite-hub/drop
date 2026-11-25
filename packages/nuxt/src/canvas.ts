import { createRequire } from "node:module"
import { join, posix } from "node:path"

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
  file?: string
  alias?: string | string[]
  redirect?: unknown
  _sync?: boolean
  meta?: { canvas?: false | CanvasPageMeta }
  children?: ResolvedRoute[]
}

const routeParam = /(?<!\\):([\w]+)(?:\(((?:\\.|[^\\)])*)\))?([?*+])?/g

function isCatchAll(pattern: string | undefined): boolean {
  return pattern === ".*" || pattern === "[^/]*"
}

export function canvasManifest(
  routes: ResolvedRoute[],
  include: (page: CanvasPage, route: ResolvedRoute) => boolean = () => true,
): CanvasManifest {
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
          return !isCatchAll(pattern) || Boolean(params?.[name])
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
        if (include(page, route)) pages.push(page)
      }
    }
    for (const child of children) visit(child, path)
  }
  for (const route of routes) visit(route, "")
  return { pages }
}

interface MatcherRoute {
  path: string
  name?: string
  alias?: string | string[]
  redirect?: unknown
  component?: object
  meta: { source: ResolvedRoute }
  children?: MatcherRoute[]
}

interface PathMatchingOptions {
  strict?: boolean
  sensitive?: boolean
}

interface VueRouterMatcherAPI {
  createRouterMatcher(
    this: void,
    routes: MatcherRoute[],
    options: PathMatchingOptions,
  ): { resolve(location: { path: string }, current: { path?: string }): { matched: MatcherRoute[] } }
}

export function canvasRouteOwner(rootDir: string, routes: ResolvedRoute[], options: PathMatchingOptions = {}) {
  const requireFromApp = createRequire(join(rootDir, "package.json"))
  const requireFromNuxt = createRequire(requireFromApp.resolve("nuxt/package.json"))
  const router: VueRouterMatcherAPI = requireFromNuxt("vue-router")
  const toMatcherRoute = (route: ResolvedRoute): MatcherRoute => ({
    path: route.path,
    name: route.name,
    ...(route.alias ? { alias: route.alias } : {}),
    redirect: route.redirect,
    component: route.file ? {} : undefined,
    meta: { source: route },
    children: route.children?.map(toMatcherRoute),
  })
  const matcher = router.createRouterMatcher(routes.map(toMatcherRoute), options)
  return (url: string) => matcher.resolve({ path: url }, {}).matched.at(-1)?.meta.source
}

function prerenderKey(path: string): string {
  return path.replace(/\/$/, "") || "/"
}

interface PrerenderedRoute {
  route: string
  fileName?: string
  contentType?: string
}

export function canvasPrerenderedPage(entries: PrerenderedRoute[], owner: ReturnType<typeof canvasRouteOwner>) {
  const files = new Map<string, { route: ResolvedRoute | undefined; key: string; html: boolean } | null>()
  for (const entry of entries) {
    if (!entry.fileName) continue
    const filename = posix.normalize(`/${entry.fileName}`)
    if (!filename.endsWith(".html")) continue
    const route = owner(encodeURI(entry.route))
    const key = prerenderKey(entry.route)
    const html = !entry.contentType || entry.contentType.includes("text/html")
    const previous = files.get(filename)
    if (previous === undefined) files.set(filename, { route, key, html })
    else if (previous && (previous.route !== route || previous.key !== key || previous.html !== html)) {
      files.set(filename, null)
    }
  }

  const rendered = new Map<ResolvedRoute, Set<string>>()
  for (const file of files.values()) {
    if (!file?.html || !file.route) continue
    let keys = rendered.get(file.route)
    if (!keys) rendered.set(file.route, (keys = new Set()))
    keys.add(file.key)
  }
  return (url: string, route: ResolvedRoute) =>
    owner(url) === route && rendered.get(route)?.has(prerenderKey(decodeURI(url))) === true
}

function joinPath(parent: string, path: string): string {
  if (path.startsWith("/")) return path
  if (!path) return parent || "/"
  return `${parent}${parent.endsWith("/") ? "" : "/"}${path}`
}

function encodeLiteral(text: string): string {
  return encodeURI(text.replace(/\\(.)/g, "$1")).replace(/[?#]/g, encodeURIComponent)
}

export function canvasPageURL({ path, params }: CanvasPage): string | undefined {
  let url = ""
  let offset = 0
  for (const match of path.matchAll(routeParam)) {
    const [token, name, pattern, modifier] = match
    const value = params?.[name]
    const literal = path.slice(offset, match.index)
    offset = match.index + token.length
    if (value) {
      url += encodeLiteral(literal) + encodeURIComponent(value)
    } else {
      if (isCatchAll(pattern) || (modifier !== "?" && modifier !== "*")) return
      const wholeSegment = literal.endsWith("/") && (path[offset] === "/" || offset === path.length)
      url += encodeLiteral(wholeSegment ? literal.slice(0, -1) : literal)
    }
  }
  return url + encodeLiteral(path.slice(offset)) || "/"
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
