import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { migrate, reset, state, who } from "../cost/harness.mjs"
import { isPreviewLink, linkText } from "../../shared/resources.ts"
const { withDocProperties, renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")
const { createDocDrop, dropDetail, findDrop } = await import("../../server/utils/drops.ts")
const { saveResources } = await import("../../server/utils/resources.ts")

migrate()
beforeEach(reset)

const PR = "https://github.com/acme/portal/pull/42"
const PREVIEW = { url: "https://pr42-demo.preview.quiver.dk/", title: "Preview" }
const at = Date.UTC(2026, 10, 5, 15)
const strip = (html) =>
  html
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, "")
    .replace(/>\s+/g, ">")
    .replace(/\s+</g, "<")

test("a preview stays in the header; a link reads as owner/repo#n, its title, or its address", () => {
  assert.equal(isPreviewLink(PREVIEW), true)
  assert.equal(isPreviewLink({ url: "https://pr7.preview.example.com/" }), true)
  assert.equal(isPreviewLink({ url: PR, title: "PR #42" }), false)
  assert.equal(isPreviewLink({ url: "https://www.figma.com/file/x", title: " preview " }), true)
  assert.equal(isPreviewLink({ url: "https://www.figma.com/file/x", title: "Design preview" }), false)
  assert.equal(linkText({ url: PR }), "acme/portal#42")
  assert.equal(linkText({ url: PR, title: "PR #42" }), "PR #42")
  assert.equal(linkText({ url: "https://www.figma.com/file/x" }), "figma.com/file/x")
})

test("a doc's links and its version's day join its front matter rows, once each, previews aside", async () => {
  const source = `---\nstatus: Ready\npr: ${PR}\n---\n\n# Plan\n\nText.\n`
  const { html } = await renderMarkdownCached("props-1.md", async () => source)
  const merged = strip(
    await withDocProperties(html, {
      resources: [
        { url: PR, title: "PR #42" },
        PREVIEW,
        { url: "https://linear.app/acme/issue/ACM-7", title: "ACM-7" },
      ],
      updatedAt: at,
    }),
  )
  assert.equal(merged.match(/<dl class="cfm">/g).length, 1, "one box")
  assert.match(
    merged,
    /data-key="status".*data-key="pr".*data-key="links".*data-key="updated"/,
    "after the front matter's rows",
  )
  assert.equal(
    merged.match(/github\.com\/acme\/portal\/pull\/42/g).length,
    1,
    "the PR the front matter shows isn't repeated",
  )
  assert.match(merged, /<dt>Link<\/dt><dd><a href="https:\/\/linear\.app\/acme\/issue\/ACM-7">ACM-7<\/a><\/dd>/)
  assert.doesNotMatch(merged, /preview\.quiver\.dk/)
  assert.match(merged, /<dt>Updated<\/dt><dd><time datetime="2026-11-05">Nov 5, 2026<\/time><\/dd>/)
  assert.ok(merged.indexOf('class="cfm"') < merged.indexOf("<h1"), "at the top, above the title")
})

test("a doc without front matter gets the box, with its styles", async () => {
  const { html } = await renderMarkdownCached("props-2.md", async () => "# Plan\n\nText.\n")
  assert.doesNotMatch(html, /class="cfm"/)
  const boxed = await withDocProperties(html, {
    resources: [{ url: PR }, { url: "https://acme.dev/spec" }],
    updatedAt: at,
  })
  assert.match(boxed, /^<style data-comark-properties>/)
  assert.match(
    strip(boxed),
    /<dt>Links<\/dt><dd><span class="cfm-tag"><a href="[^"]+pull\/42">acme\/portal#42<\/a><\/span><span class="cfm-tag"><a href="https:\/\/acme\.dev\/spec">acme\.dev\/spec<\/a><\/span><\/dd>/,
  )
})

test("the doc the viewer gets carries them; its source and cached render don't", async () => {
  state.who = who
  const row = await createDocDrop(who, {
    filename: "plan.md",
    bytes: new TextEncoder().encode("# Plan\n\nText.\n"),
    lifetime: "review",
  })
  await saveResources(row, [{ url: PR, title: "PR #42" }, PREVIEW])
  const detail = await dropDetail(await findDrop(row.id), who, "https://drop.example")
  assert.match(
    strip(detail.html),
    /<dt>Link<\/dt><dd><a href="https:\/\/github\.com\/acme\/portal\/pull\/42">PR #42<\/a>/,
  )
  assert.doesNotMatch(detail.html, /preview\.quiver\.dk/)
  assert.equal(detail.content, "# Plan\n\nText.\n")
  assert.deepEqual(
    detail.resources.map((resource) => resource.url),
    [PR, PREVIEW.url],
    "Details still lists both",
  )
  assert.doesNotMatch((await renderMarkdownCached(row.blobKey, async () => "")).html, /data-key="links"/)
})
