import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { migrate, reset, state, who } from "../cost/harness.mjs"
import { linkText } from "../../shared/resources.ts"
const { withDocProperties, renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")
const { createDocDrop, dropDetail, findDrop } = await import("../../server/utils/drops.ts")
const { saveResources } = await import("../../server/utils/resources.ts")

migrate()
beforeEach(reset)

const PR = "https://github.com/acme/portal/pull/42"
const PREVIEW = { url: "https://pr42-demo.preview.example.com/", title: "Preview" }
const at = Date.UTC(2026, 10, 5, 15)
const strip = (html) =>
  html
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, "")
    .replace(/>\s+/g, ">")
    .replace(/\s+</g, "<")

test("a link reads as owner/repo#n, its title, or its address", () => {
  assert.equal(linkText({ url: PR }), "acme/portal#42")
  assert.equal(linkText({ url: PR, title: "PR #42" }), "PR #42")
  assert.equal(linkText({ url: "https://www.figma.com/file/x" }), "figma.com/file/x")
})

test("a doc's links, its preview deploy too, and its version's day join its front matter rows, once each", async () => {
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
  assert.equal(merged.match(/<dl class="cfm"[^>]*>/g).length, 1, "one box")
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
  assert.match(
    merged,
    /<dt>Links<\/dt><dd><a class="cp" href="https:\/\/pr42-demo\.preview\.example\.com\/" data-kind="favicon"><img class="cp-img" src="\/api\/favicons\/pr42-demo\.preview\.example\.com" alt="">Preview<\/a><a class="cp" href="https:\/\/linear\.app\/acme\/issue\/ACM-7" data-kind="favicon"><img class="cp-img" src="\/api\/favicons\/linear\.app" alt="">ACM-7<\/a><\/dd>/,
  )
  assert.match(
    merged,
    /<dt>Updated<\/dt><dd><time class="ctm" datetime="2026-11-05T15:00:00(\.000)?Z"[^>]*>Nov 5, 2026<span class="ctm-tip"/,
    "the version's instant, which the box's script writes as relative words with the full date in a tooltip",
  )
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
    /<dt>Links<\/dt><dd><a class="cp" href="[^"]+pull\/42" data-kind="favicon"><img class="cp-img" src="\/api\/favicons\/github\.com" alt="">acme\/portal#42<\/a><a class="cp" href="https:\/\/acme\.dev\/spec" data-kind="favicon"><img class="cp-img" src="\/api\/favicons\/acme\.dev" alt="">acme\.dev\/spec<\/a><\/dd>/,
  )
})

test("a doc's box and text carry the chips' styles once, whichever of them has chips", async () => {
  const chipStyles = (html) => html.match(/<style data-comark-chips[^>]*>/g)?.length ?? 0
  const links = { resources: [{ url: "https://linear.app/acme/issue/ACM-7", title: "ACM-7" }], updatedAt: at }
  for (const source of [
    `---\nstatus: Ready\npr: ${PR}\n---\n\n# Plan\n\nSee https://vite.dev.\n`,
    `---\nstatus: Ready\n---\n\n# Plan\n\nText.\n`,
    "# Plan\n\nSee https://vite.dev.\n",
  ]) {
    const { html } = await renderMarkdownCached(`props-chips-${source.length}.md`, async () => source)
    assert.equal(chipStyles(await withDocProperties(html, links)), 1, source)
  }
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
    /<dt>Links<\/dt><dd><a class="cp" href="https:\/\/github\.com\/acme\/portal\/pull\/42" data-kind="favicon"><img class="cp-img" src="https:\/\/drop\.example\/api\/favicons\/github\.com" alt="">PR #42<\/a><a class="cp" href="https:\/\/pr42-demo\.preview\.example\.com\/" data-kind="favicon"><img class="cp-img" src="https:\/\/drop\.example\/api\/favicons\/pr42-demo\.preview\.example\.com" alt="">Preview<\/a>/,
  )
  assert.equal(detail.content, "# Plan\n\nText.\n")
  assert.deepEqual(
    detail.resources.map((resource) => resource.url),
    [PR, PREVIEW.url],
    "Details still lists both",
  )
  assert.doesNotMatch((await renderMarkdownCached(row.blobKey, async () => "")).html, /data-key="links"/)
})

test("a front matter resources list feeds the doc's links and isn't a row of its own", async () => {
  const source = `---\nstatus: Ready\nresources:\n  - ${PR}\n---\n\n# Plan\n`
  const { html } = await renderMarkdownCached("props-resources.md", async () => source)
  const merged = strip(await withDocProperties(html, { resources: [{ url: PR }], updatedAt: at }))
  assert.match(merged, /data-key="status".*data-key="links".*data-key="updated"/)
  assert.doesNotMatch(merged, /data-key="resources"/)
  assert.equal(merged.match(/github\.com\/acme\/portal\/pull\/42/g).length, 1)
})

test("the Updated row brings the date script to a box without a date, once, and the CSP allows it", async () => {
  const { RENDERER_SCRIPTS } = await import("../../server/utils/markdown-document.ts")
  const scriptsOf = (html) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, script]) => script)
  for (const [name, source] of [
    ["undated", `---\nstatus: Ready\n---\n\n# Plan\n`],
    ["dated", `---\nstatus: Ready\ndate: 2026-10-23\n---\n\n# Plan\n`],
    ["bare", "# Plan\n"],
  ]) {
    const { html } = await renderMarkdownCached(`props-script-${name}.md`, async () => source)
    const merged = await withDocProperties(html, { resources: [], updatedAt: at })
    const scripts = scriptsOf(merged)
    assert.equal(scripts.length, 2, `${name}: the relative dates and comark-time's Escape, once each`)
    for (const script of scripts) assert.ok(RENDERER_SCRIPTS.includes(script), `${name}: the CSP allows it`)
    // The relative-dates script reads the box right before it.
    assert.match(merged, /<\/dl><script>/, name)
    assert.equal(merged.match(/<style data-comark-time>/g)?.length, 1, `${name}: comark-time's styles once`)
  }
})
