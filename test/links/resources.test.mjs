import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import {
  faviconUrl,
  linkSource,
  mergeResources,
  pullRequestOf,
  resourceLabel,
  resourceUrl,
} from "../../shared/resources.ts"

test("a link is https, or http on this computer, normalized", () => {
  assert.equal(resourceUrl(" https://GitHub.com/acme/app/pull/1 "), "https://github.com/acme/app/pull/1")
  assert.equal(resourceUrl("http://localhost:3000/x"), "http://localhost:3000/x")
  assert.equal(resourceUrl("http://example.com"), null)
  assert.equal(resourceUrl("https://user:secret@example.com"), null)
  assert.equal(resourceUrl("javascript:alert(1)"), null)
  assert.equal(resourceUrl("github.com/acme"), null)
})

test("a site's icon comes from Drop, by its host", () => {
  assert.equal(faviconUrl("https://github.com/acme/app/pull/1"), "/api/favicons/github.com")
  assert.equal(
    faviconUrl("http://app.localhost:3000/", "https://drop.example"),
    "https://drop.example/api/favicons/app.localhost",
  )
})

test("a link without a title shows its host; merging keeps places and takes new titles", () => {
  assert.equal(resourceLabel({ url: "https://www.figma.com/file/x" }), "figma.com")
  assert.equal(resourceLabel({ url: "https://github.com/a/b/pull/1", title: "PR #1" }), "PR #1")
  assert.equal(resourceLabel({ url: "https://github.com/a/b/issues/7" }), "a/b#7")
  assert.deepEqual(
    mergeResources(
      [{ url: "https://a.dev/" }, { url: "https://b.dev/", title: "B" }],
      [{ url: "https://c.dev/" }, { url: "https://a.dev/", title: "A" }, { url: "https://b.dev/" }],
    ),
    [{ url: "https://a.dev/", title: "A" }, { url: "https://b.dev/", title: "B" }, { url: "https://c.dev/" }],
  )
})

test("a GitHub pull request link says its repo and number; any other link its host", () => {
  assert.deepEqual(pullRequestOf("https://github.com/quiverdk/website/pull/33"), {
    repo: "quiverdk/website",
    number: 33,
  })
  assert.deepEqual(pullRequestOf("https://github.com/vite-hub/drop/pull/7/files"), { repo: "vite-hub/drop", number: 7 })
  assert.equal(pullRequestOf("https://github.com/quiverdk/website/issues/33"), null)
  assert.equal(pullRequestOf("https://gitlab.com/a/b/pull/1"), null)
  assert.equal(linkSource("https://github.com/quiverdk/website/pull/33"), "quiverdk/website#33")
  assert.equal(linkSource("https://www.figma.com/file/x"), "figma.com")
})
