import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { canvasManifest, canvasPageURL, canvasRouteOwner, routeRuleRedirects } from "../src/canvas.ts"

describe("canvasManifest", () => {
  it("lists every page, children included, with their full paths", () => {
    expect(
      canvasManifest([
        { path: "/", name: "index" },
        { path: "/about", name: "about" },
        {
          path: "/orders",
          children: [
            { path: "", name: "orders" },
            { path: ":id()", name: "orders-id", meta: { canvas: { params: { id: "42" } } } },
          ],
        },
        { path: "/settings", name: "settings", children: [{ path: "profile", name: "settings-profile" }] },
      ]),
    ).toEqual({
      pages: [
        { path: "/", name: "index" },
        { path: "/about", name: "about" },
        { path: "/orders", name: "orders" },
        { path: "/orders/:id", name: "orders-id", params: { id: "42" } },
        { path: "/settings", name: "settings" },
        { path: "/settings/profile", name: "settings-profile" },
      ],
    })
  })

  it("keeps a param that shares its segment with text", () => {
    expect(
      canvasManifest([
        {
          path: "/products/:product()_details",
          name: "products-product_details",
          meta: { canvas: { params: { product: "42" } } },
        },
      ]).pages,
    ).toEqual([{ path: "/products/:product()_details", name: "products-product_details", params: { product: "42" } }])
  })

  it("preserves literal parentheses", () => {
    expect(canvasManifest([{ path: "/help()/faq()", name: "faq" }]).pages).toEqual([
      { path: "/help()/faq()", name: "faq" },
    ])
  })

  it("leaves out pages with canvas: false, redirects and Nuxt's route rule redirects", () => {
    expect(
      canvasManifest([
        { path: "/admin", name: "admin", meta: { canvas: false }, children: [{ path: "users", name: "admin-users" }] },
        { path: "/old", name: "old", redirect: "/" },
        { path: "/legacy/:pathMatch(.*)", _sync: true },
        { path: "/moved", _sync: true },
      ]).pages,
    ).toEqual([{ path: "/admin/users", name: "admin-users" }])
  })

  it("skips a catch-all route unless it has sample params", () => {
    expect(
      canvasManifest([
        { path: "/:slug(.*)*", name: "slug" },
        { path: "/:empty(.*)*", meta: { canvas: { params: {} } } },
        { path: "/:wrong(.*)*", meta: { canvas: { params: { other: "intro" } } } },
        { path: "/:slug([^/]*)*/edit", name: "edit" },
        { path: "/:slug([^/]*)*/view", name: "view", meta: { canvas: { params: { slug: "intro" } } } },
        { path: "/docs/:path(.*)*", name: "docs-path", meta: { canvas: { params: { path: "intro" } } } },
      ]).pages,
    ).toEqual([
      { path: "/:slug([^/]*)*/view", name: "view", params: { slug: "intro" } },
      { path: "/docs/:path(.*)*", name: "docs-path", params: { path: "intro" } },
    ])
  })
})

it("only assigns a concrete URL to the route Vue Router would open", () => {
  const index = { path: "/", file: "index.vue" }
  const language = { path: "/:lang?", file: "[[lang]].vue" }
  const blog = { path: "/blog/:slug?", file: "blog/[[slug]].vue" }
  const owner = canvasRouteOwner(fileURLToPath(new URL("..", import.meta.url)), [language, blog, index])

  expect(owner(canvasPageURL(language)!)).toBe(index)
  expect(owner(canvasPageURL({ ...language, params: { lang: "en" } })!)).toBe(language)
  expect(owner(canvasPageURL(blog)!)).toBe(blog)
})

it("matches canvas route owners with the app's path matching options", () => {
  const title = { path: "/docs/TITLE", file: "docs/TITLE.vue" }
  const article = { path: "/docs/:slug?", file: "docs/[[slug]].vue" }
  const rootDir = fileURLToPath(new URL("..", import.meta.url))
  expect(canvasRouteOwner(rootDir, [title, article])("/docs/title")).toBe(title)

  const owner = canvasRouteOwner(rootDir, [title, article], { sensitive: true, strict: true })
  expect(owner("/docs/title")).toBe(article)
  expect(owner("/docs/TITLE")).toBe(title)
  expect(owner("/docs/title/")).toBeUndefined()
})

it("preserves the trailing slash of strict routes and their index children", () => {
  const about = { path: "/about/", file: "about.vue" }
  const index = { path: "", file: "docs/index.vue" }
  const guide = { path: ":topic()/", file: "docs/[topic].vue", meta: { canvas: { params: { topic: "intro" } } } }
  const routes = [about, { path: "/docs/", children: [index, guide] }]
  const owner = canvasRouteOwner(fileURLToPath(new URL("..", import.meta.url)), routes, { strict: true })
  const { pages } = canvasManifest(routes, (page, route) => owner(canvasPageURL(page)!) === route)

  expect(pages.map((page) => page.path)).toEqual(["/about/", "/docs/", "/docs/:topic/"])
  expect(pages.map(canvasPageURL)).toEqual(["/about/", "/docs/", "/docs/intro/"])
})

describe("canvasPageURL", () => {
  it("requires mandatory parameters and encodes sample values as path segments", () => {
    expect(canvasPageURL({ path: "/:team/:product()_details", params: { product: "x" } })).toBeUndefined()
    expect(canvasPageURL({ path: "/:team/:product()_details", params: { team: "a/b", product: "? #" } })).toBe(
      "/a%2Fb/%3F%20%23_details",
    )
  })

  it("omits unsampled optional parameters and their separator when alone in a segment", () => {
    expect(canvasPageURL({ path: "/blog/:slug?" })).toBe("/blog")
    expect(canvasPageURL({ path: "/:lang?/blog/:slug?/edit" })).toBe("/blog/edit")
    expect(canvasPageURL({ path: "/:lang?/:slug?" })).toBe("/")
    expect(canvasPageURL({ path: "/docs/:slug()?_details" })).toBe("/docs/_details")
    expect(canvasPageURL({ path: "/blog/:slug?", params: { slug: "a/b" } })).toBe("/blog/a%2Fb")
    expect(canvasPageURL({ path: "/docs/:slug(.*)*" })).toBeUndefined()
    expect(canvasPageURL({ path: "/docs/:slug([^/]*)*/edit" })).toBeUndefined()
  })
})

describe("Nitro 2 route rules", () => {
  it("finds exact and wildcard redirects without treating literal pages as redirects", () => {
    const rules = { "/legacy": { redirect: "/" }, "/old/**": { redirect: "/" }, "/orders/*": { redirect: "/" } }
    expect(routeRuleRedirects(rules, "/legacy")).toBe(true)
    expect(routeRuleRedirects(rules, "/legacy/child")).toBe(false)
    expect(routeRuleRedirects(rules, "/old/sub/page")).toBe(true)
    expect(routeRuleRedirects(rules, "/orders/42")).toBe(true)
    expect(routeRuleRedirects(rules, "/orders/42/edit")).toBe(false)
  })
})
