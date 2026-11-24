import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import {
  deferImages,
  deferMedia,
  deferPdfs,
  embeddedImagePaths,
  embeddedMediaPaths,
  embeddedPdfPaths,
} from "../../shared/embedded-images.ts"

const a = "11111111-1111-4111-8111-111111111111"
const b = "22222222-2222-4222-8222-222222222222"
const c = "33333333-3333-4333-8333-333333333333"

test("a doc's linked screenshots are inlined, not only its attachments", () => {
  // A pr-evidence doc: screenshots published as their own drops, embedded by their absolute fileUrl.
  const markdown = `![Before](https://drop.quiver.dk/f/${a}.png)\n![After](/f/${b}.webp?raw)`
  assert.deepEqual(embeddedImagePaths([markdown], "drop.quiver.dk", [`/f/${c}.png`]), [
    `/f/${c}.png`,
    `/f/${a}.png`,
    `/f/${b}.webp`,
  ])
})

test("other files and other Drops' images stay links", () => {
  const html = `<a href="/f/${a}.zip">logs</a><img src="https://drop.vitehub.dev/f/${b}.png"><img src="https://drop.quiver.dk/f/${c}.png">`
  assert.deepEqual(embeddedImagePaths([html], "drop.quiver.dk"), [`/f/${c}.png`])
})

test("the same image twice is fetched once, and a long doc stops at 60", () => {
  const ids = Array.from({ length: 70 }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`)
  const markdown = ids.map((id) => `![](/f/${id}.png)`).join("\n")
  assert.equal(embeddedImagePaths([markdown, markdown], "drop.quiver.dk").length, 60)
  assert.deepEqual(embeddedImagePaths([`![](/f/${a}.png)`, `<img src="/f/${a}.png">`], "x"), [`/f/${a}.png`])
})

test("a Markdown doc's images wait in the frame, keyed by path; other images and links stay as they are", () => {
  const html = `<p><img src="https://drop.quiver.dk/f/${a}.png" alt="Before" loading="lazy"> <img src="/f/${b}.webp?raw" alt=""><img src="/f/${c}.png" srcset="/f/${c}.png 1x" sizes="100vw"></p><a href="/f/${a}.png">full size</a><img src="https://example.com/x.png"><img src="/f/${c}.png">`
  const deferred = deferImages(html, [`/f/${a}.png`, `/f/${b}.webp`])
  assert.match(
    deferred,
    new RegExp(
      `<img src="data:image/gif;base64,[^"]+" data-drop-image="/f/${a}.png" data-drop-src="https://drop.quiver.dk/f/${a}.png" alt="Before" loading="lazy">`,
    ),
  )
  assert.match(
    deferred,
    new RegExp(
      `<img src="data:image/gif;base64,[^"]+" data-drop-image="/f/${b}.webp" data-drop-src="/f/${b}.webp\\?raw" alt="">`,
    ),
  )
  assert.match(
    deferred,
    new RegExp(`<a href="/f/${a}.png">full size</a><img src="https://example.com/x.png"><img src="/f/${c}.png">$`),
  )
})

test("srcset candidates are deferred and srcset-only images get a placeholder", () => {
  const html = `<img src="/fallback.png" srcset="/f/${a}.png 1x, /f/${b}.webp 2x" sizes="50vw"><img srcset="/f/${b}.webp 1x, /f/${c}.png 2x" sizes="100vw">`
  const deferred = deferImages(html, [`/f/${a}.png`, `/f/${b}.webp`])
  assert.match(
    deferred,
    new RegExp(
      `<img src="data:image/gif;base64,[^"]+" data-drop-image="/f/${a}.png" data-drop-src="/f/${a}.png"><img src="data:image/gif;base64,[^"]+" data-drop-image="/f/${b}.webp" data-drop-src="/f/${b}.webp">`,
    ),
  )
  assert.doesNotMatch(deferred, /srcset|sizes/)
})

test("a doc's videos and audio on this Drop are handed in too, and its attachments that play", () => {
  const markdown = `![The flow](https://drop.quiver.dk/f/${a}.mp4){loop muted}\n![](/f/${b}.mp3)\n![](https://drop.vitehub.dev/f/${c}.webm)\n![](/f/${c}.png)`
  assert.deepEqual(embeddedMediaPaths([markdown], "drop.quiver.dk", [`/f/${c}.mov`, `/f/${c}.pdf`]), [
    `/f/${c}.mov`,
    `/f/${a}.mp4`,
    `/f/${b}.mp3`,
  ])
})

test("a Markdown doc's videos and audio wait in the frame without a source; other players stay as they are", () => {
  const html = `<span class="cm cm-video"><video src="https://drop.quiver.dk/f/${a}.mp4" controls playsinline preload="metadata" loop muted><a href="https://drop.quiver.dk/f/${a}.mp4">The flow</a></video></span><audio src="/f/${b}.mp3" controls></audio><video src="https://example.com/x.mp4" controls></video>`
  const deferred = deferMedia(html, [`/f/${a}.mp4`, `/f/${b}.mp3`])
  assert.match(
    deferred,
    new RegExp(
      `<video data-drop-media="/f/${a}.mp4" controls playsinline preload="metadata" loop muted><a href="https://drop.quiver.dk/f/${a}.mp4">`,
    ),
  )
  assert.match(deferred, new RegExp(`<audio data-drop-media="/f/${b}.mp3" controls>`))
  assert.match(deferred, /<video src="https:\/\/example.com\/x.mp4" controls>/)
})

// A PDF box as server/utils/markdown-document.ts renders `![title](src)` alone on a line.
const box = (src, title = "PDF") =>
  `<figure class="drop-embed" data-drop-src="${src}" data-kind="pdf" data-title="${title}"><a class="drop-embed-link" href="${src}">${title}</a></figure>`

test("a doc shows the pages of its first 10 PDF boxes on this Drop; links to PDFs and other files don't count", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`)
  // Ten references to PDFs as plain links, then the one PDF the doc shows: a CV under a cover letter.
  const references = ids.slice(0, 10).map((id) => `<p><a href="/f/${id}.pdf">Reference</a></p>`)
  const html = `${references.join("")}${box(`/f/${a}.pdf?raw`, "CV")}<p><img src="/f/${c}.png"></p>`
  assert.deepEqual(embeddedPdfPaths(html, "drop.example.com"), [`/f/${a}.pdf`])

  const boxes = ids.map((id, i) => box(i % 2 ? `https://drop.example.com/f/${id}.pdf` : `/f/${id}.pdf`)).join("")
  assert.deepEqual(
    embeddedPdfPaths(boxes + box(`/f/${ids[0]}.pdf`), "drop.example.com"),
    ids.slice(0, 10).map((id) => `/f/${id}.pdf`),
  )
})

test("a PDF box on another Drop stays its link, and one on this Drop is handed its file", () => {
  const html = box(`https://drop.example.com/f/${a}.pdf`, "CV") + box(`https://other.example.com/f/${b}.pdf`, "Deck")
  assert.deepEqual(embeddedPdfPaths(html, "drop.example.com"), [`/f/${a}.pdf`])
  assert.equal(
    deferPdfs(html, "drop.example.com"),
    `<figure class="drop-embed" data-drop-src="https://drop.example.com/f/${a}.pdf" data-drop-file="/f/${a}.pdf" data-kind="pdf" data-title="CV"><a class="drop-embed-link" href="https://drop.example.com/f/${a}.pdf">CV</a></figure>` +
      box(`https://other.example.com/f/${b}.pdf`, "Deck"),
  )
})
