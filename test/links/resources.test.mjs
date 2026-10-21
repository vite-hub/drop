import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { faviconUrls, mergeResources, resourceLabel, resourceUrl } from "../../shared/resources.ts"

test("a link is https, or http on this computer, normalized", () => {
  assert.equal(resourceUrl(" https://GitHub.com/acme/app/pull/1 "), "https://github.com/acme/app/pull/1")
  assert.equal(resourceUrl("http://localhost:3000/x"), "http://localhost:3000/x")
  assert.equal(resourceUrl("http://example.com"), null)
  assert.equal(resourceUrl("https://user:secret@example.com"), null)
  assert.equal(resourceUrl("javascript:alert(1)"), null)
  assert.equal(resourceUrl("github.com/acme"), null)
})

test("a site's icon is looked up on its host, then on each domain above it", () => {
  assert.deepEqual(faviconUrls("https://github.com/acme/app/pull/1"), ["https://github.com/favicon.ico"])
  assert.deepEqual(faviconUrls("https://pr42-demo.preview.quiver.dk/page"), [
    "https://pr42-demo.preview.quiver.dk/favicon.ico",
    "https://preview.quiver.dk/favicon.ico",
    "https://quiver.dk/favicon.ico",
  ])
  assert.deepEqual(faviconUrls("http://app.localhost:3000/"), ["http://app.localhost:3000/favicon.ico"])
  assert.deepEqual(faviconUrls("https://192.168.1.4/"), ["https://192.168.1.4/favicon.ico"])
})

test("a link without a title shows its host; merging keeps places and takes new titles", () => {
  assert.equal(resourceLabel({ url: "https://www.figma.com/file/x" }), "figma.com")
  assert.equal(resourceLabel({ url: "https://github.com/a/b/pull/1", title: "PR #1" }), "PR #1")
  assert.deepEqual(
    mergeResources(
      [{ url: "https://a.dev/" }, { url: "https://b.dev/", title: "B" }],
      [{ url: "https://c.dev/" }, { url: "https://a.dev/", title: "A" }, { url: "https://b.dev/" }],
    ),
    [{ url: "https://a.dev/", title: "A" }, { url: "https://b.dev/", title: "B" }, { url: "https://c.dev/" }],
  )
})
