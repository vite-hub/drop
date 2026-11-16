import assert from "node:assert/strict"
import { afterEach, test, vi } from "vite-plus/test"

const { siteIcon, absoluteFavicons, FAVICON_HOST } = await import("../../server/utils/favicons.ts")

const PNG = new Uint8Array([137, 80, 78, 71])
const asked = []
afterEach(() => {
  vi.unstubAllGlobals()
  asked.length = 0
})

/** Google's favicon service, knowing only the hosts in `known`. */
function google(known, type = "image/png") {
  vi.stubGlobal("fetch", async (url) => {
    const host = new URL(url).searchParams.get("domain")
    asked.push(host)
    return known.includes(host)
      ? new Response(PNG, { headers: { "content-type": type } })
      : new Response("globe", { status: 404, headers: { "content-type": "image/png" } })
  })
}

test("a host without an icon of its own takes the first domain above it that has one", async () => {
  google(["example.com"])
  const icon = await siteIcon("pr42.preview.example.com")
  assert.deepEqual(asked, ["pr42.preview.example.com", "preview.example.com", "example.com"])
  assert.equal(icon.type, "image/png")
  assert.equal(icon.missing, undefined)
})

test("no icon anywhere, or one that isn't a raster image, is a link icon", async () => {
  google([])
  assert.equal((await siteIcon("nothing.example.org")).type, "image/svg+xml")
  google(["svg.example.net"], "image/svg+xml")
  const icon = await siteIcon("svg.example.net")
  assert.equal(icon.type, "image/svg+xml")
  assert.equal(icon.missing, true, "Drop's own link icon, never the site's SVG")
})

test("a host name is all the endpoint takes, and a doc's icons point at Drop", () => {
  assert.ok(FAVICON_HOST.test("github.com"))
  for (const bad of ["github.com/x", "GitHub.com", "a..b", "x".repeat(254), "github.com:443", "../etc"])
    assert.ok(!FAVICON_HOST.test(bad), bad)
  assert.equal(
    absoluteFavicons('<img class="cp-img" src="/api/favicons/github.com">', "https://drop.example"),
    '<img class="cp-img" src="https://drop.example/api/favicons/github.com">',
  )
})
