import { describe, expect, it } from "vitest"

import { canvasManifest } from "../src/canvas.ts"

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
        { path: "/docs/:path(.*)*", name: "docs-path", meta: { canvas: { params: { path: "intro" } } } },
      ]).pages,
    ).toEqual([{ path: "/docs/:path(.*)*", name: "docs-path", params: { path: "intro" } }])
  })
})
