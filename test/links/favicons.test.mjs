import assert from "node:assert/strict"
import { afterEach, test, vi } from "vite-plus/test"

const { siteIcon, absoluteFavicons, FAVICON_HOST } = await import("../../server/utils/favicons.ts")

const PNG = new Uint8Array([137, 80, 78, 71])
const asked = []
afterEach(() => {
  vi.unstubAllGlobals()
  asked.length = 0
})

/**
 * Google's favicon service, knowing the hosts in `known.google`, and DuckDuckGo's, knowing those in `known.duckduckgo`.
 * Each answers the rest with a 404 and its placeholder; `asked` records "provider host" for every request.
 */
function providers(known, type = "image/png") {
  vi.stubGlobal("fetch", async (url) => {
    const at = new URL(url)
    const google = at.hostname === "www.google.com"
    const host = google ? at.searchParams.get("domain") : at.pathname.replace(/^\/ip3\//, "").replace(/\.ico$/, "")
    const provider = google ? "google" : "duckduckgo"
    asked.push(`${provider} ${host}`)
    return (known[provider] ?? []).includes(host)
      ? new Response(PNG, { headers: { "content-type": type } })
      : new Response("placeholder", { status: 404, headers: { "content-type": "image/png" } })
  })
}
const tileText = (icon) => atob(icon.body)

test("a host without an icon of its own takes the first domain above it that has one", async () => {
  providers({ google: ["example.com"] })
  const icon = await siteIcon("pr42.preview.example.com")
  assert.deepEqual(
    asked.filter((line) => line.startsWith("google")),
    ["google pr42.preview.example.com", "google preview.example.com", "google example.com"],
  )
  assert.equal(icon.type, "image/png")
  assert.equal(icon.missing, undefined)
})

test("DuckDuckGo finds a public preview Google has never crawled, and Google wins when both know a host", async () => {
  providers({ duckduckgo: ["deploy-preview-7--docs.example.dev"] })
  const preview = await siteIcon("deploy-preview-7--docs.example.dev")
  assert.equal(preview.missing, undefined)
  assert.deepEqual(asked, [
    "google deploy-preview-7--docs.example.dev",
    "duckduckgo deploy-preview-7--docs.example.dev",
  ])

  const GIF = new Uint8Array([71, 73, 70])
  vi.stubGlobal("fetch", async (url) =>
    new URL(url).hostname === "www.google.com"
      ? new Response(PNG, { headers: { "content-type": "image/png" } })
      : new Response(GIF, { headers: { "content-type": "image/gif" } }),
  )
  assert.equal((await siteIcon("both.example.io")).type, "image/png")
})

test("a site under a public suffix never takes the suffix's icon, and gets its own letter tile", async () => {
  providers({ google: ["netlify.app"], duckduckgo: ["netlify.app"] })
  const icon = await siteIcon("acme.netlify.app")
  assert.deepEqual(asked, ["google acme.netlify.app", "duckduckgo acme.netlify.app"], "netlify.app isn't asked")
  assert.equal(icon.type, "image/svg+xml")
  assert.equal(icon.missing, true)
  assert.match(tileText(icon), />A<\/text>/)
})

test("no icon anywhere, or one that isn't a raster image, is the site's letter tile", async () => {
  providers({})
  const none = await siteIcon("nothing.example.org")
  assert.equal(none.type, "image/svg+xml")
  assert.match(tileText(none), />E<\/text>/, "example's E, not nothing's N: the tile names the site")
  providers({ google: ["svg.example.net"], duckduckgo: ["svg.example.net"] }, "image/svg+xml")
  const icon = await siteIcon("svg.example.net")
  assert.equal(icon.missing, true, "Drop's own tile, never the site's SVG")
  assert.doesNotMatch(tileText(icon), /<script/)
  // A name with no site to ask about is never sent to a provider.
  asked.length = 0
  assert.match(tileText(await siteIcon("intranet")), />I<\/text>/)
  assert.deepEqual(asked, [])
})

test("the same site always gets the same tile, and different sites usually a different hue", async () => {
  const { siteTile } = await import("../../shared/site-tile.ts")
  assert.equal(siteTile("github"), siteTile("github"))
  const hue = (svg) => /oklch\([\d.]+ [\d.]+ (\d+)\)/.exec(svg)[1]
  assert.notEqual(hue(siteTile("github")), hue(siteTile("airtable")))
  assert.match(siteTile("<x"), />X<\/text>/)
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
