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

  it("leaves out pages with canvas: false and redirects", () => {
    expect(
      canvasManifest([
        { path: "/admin", name: "admin", meta: { canvas: false }, children: [{ path: "users", name: "admin-users" }] },
        { path: "/old", name: "old", redirect: "/" },
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
