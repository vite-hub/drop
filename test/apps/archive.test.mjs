import assert from "node:assert/strict"
import { gzipSync } from "node:zlib"
import { createTar, createTarGzip } from "nanotar"
import { test } from "vite-plus/test"
const { MAX_ARCHIVE_BYTES, unpackApp } = await import("../../server/utils/app-archive.ts")

const text = (bytes) => new TextDecoder().decode(bytes)

test("an archive unpacks to its regular files, from gzip or plain tar", async () => {
  const entries = [
    { name: "./index.html", data: "<p>hi</p>" },
    { name: "./assets/" },
    { name: "./assets/logo.png", data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
    { name: "./.DS_Store", data: "junk" },
    { name: "./assets/._logo.png", data: "junk" },
    { name: "./empty.txt", data: new Uint8Array(0) },
  ]
  for (const archive of [await createTarGzip(entries), createTar(entries)]) {
    const files = await unpackApp(archive)
    assert.deepEqual(Object.keys(files).sort(), ["assets/logo.png", "empty.txt", "index.html"])
    assert.equal(text(files["index.html"]), "<p>hi</p>")
    assert.deepEqual([...files["assets/logo.png"]], [0x89, 0x50, 0x4e, 0x47])
    assert.equal(files["empty.txt"].byteLength, 0)
  }
})

test("a lone top folder with the index.html comes off; other layouts stay as they are", async () => {
  const wrapped = await unpackApp(
    createTar([
      { name: "dist/index.html", data: "a" },
      { name: "dist/app.js", data: "b" },
    ]),
  )
  assert.deepEqual(Object.keys(wrapped).sort(), ["app.js", "index.html"])
  const nested = await unpackApp(createTar([{ name: "docs/guide.html", data: "a" }]))
  assert.deepEqual(Object.keys(nested), ["docs/guide.html"], "no index.html below it: publishApp says what's missing")
})

test("paths can't climb out of the app", async () => {
  const files = await unpackApp(
    createTar([
      { name: "../../etc/passwd", data: "x" },
      { name: "/abs.html", data: "y" },
    ]),
  )
  assert.deepEqual(Object.keys(files).sort(), ["abs.html", "etc/passwd"])
})

test("unpacking stops past the largest app, and broken archives say so", async () => {
  const bomb = gzipSync(new Uint8Array(MAX_ARCHIVE_BYTES + 1))
  assert.ok(bomb.byteLength < 100_000, "the bomb itself is small")
  await assert.rejects(unpackApp(bomb), (error) => error.status === 413 && /larger than any app/.test(error.message))
  await assert.rejects(unpackApp(new Uint8Array([0x1f, 0x8b, 1, 2, 3])), /isn't valid gzip/)
  await assert.rejects(unpackApp(createTar([{ name: "dir/" }])), /holds no files/)
})

test("a bundle's minified code doesn't read as bare imports; a real one still warns", async () => {
  const { appLinkIssues } = await import("../../shared/project-bundle.ts")
  const files = {
    "index.html": '<script type="module" src="/assets/index.js"></script>',
    "assets/index.js":
      'import{a as b}from"./vue.js";const c={"v-popper__popper--show-from":n.showFrom,"x":1};import("preact");import x from "node:fs"',
    "assets/vue.js": "export const a = 1",
  }
  assert.deepEqual(appLinkIssues(files, Object.keys(files)), [
    'assets/index.js imports "preact", a bare module name that browsers can\'t load. Import it from a CDN URL (https://esm.sh/preact) or add an import map.',
  ])
})

test("a script of a data type, such as a lesson in Markdown, isn't checked for links", async () => {
  const { appLinkIssues } = await import("../../shared/project-bundle.ts")
  const files = {
    "index.html": [
      '<script id="lesson" TYPE \n = "text/markdown">',
      '```html [index.html]\n<script type="module" src="./src/main.js"><\\/script>\n```',
      'import { format } from "./messages.js"',
      "</script>",
      '<script type="module">import "./missing.js"</script>',
      '<script data-type="text/markdown" src="attribute.js"></script>',
      '<script title="type=application/json" type="text/jscript" src = legacy.js></script>',
      '<script type="text&#47;javascript1.5" src="entity.js"></script>',
      '<script type="" src="empty.js"></script>',
    ].join("\n"),
  }
  assert.deepEqual(appLinkIssues(files, Object.keys(files)), [
    'index.html loads a module "./missing.js", but missing.js isn\'t in the app.',
    'index.html loads script "attribute.js", but attribute.js isn\'t in the app.',
    'index.html loads script "legacy.js", but legacy.js isn\'t in the app.',
    'index.html loads script "entity.js", but entity.js isn\'t in the app.',
    'index.html loads script "empty.js", but empty.js isn\'t in the app.',
  ])
})
