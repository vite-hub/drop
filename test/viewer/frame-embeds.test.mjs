import assert from "node:assert/strict"
import { afterEach, test, vi } from "vite-plus/test"
import { computed, effectScope, nextTick, onScopeDispose, ref, shallowRef, watch } from "vue"
import { useDocEmbeds } from "../../app/composables/useDocEmbeds.ts"
import { useViewerFrame } from "../../app/composables/useViewerFrame.ts"

const LINK = "k7f2q9m4x8wd"
const OTHER_LINK = "a1b2c3d4e5f6"
const ATTACHED = "/f/11111111-1111-4111-8111-111111111111.pdf"
const UNLISTED = "/f/22222222-2222-4222-8222-222222222222.pdf"
const RENDERED =
  `<figure class="drop-embed" data-drop-embed="${LINK}" data-title="Steps"></figure>` +
  `<figure class="drop-embed" data-drop-file="${ATTACHED}" data-kind="pdf" data-title="CV"></figure>` +
  `<figure class="drop-embed" data-drop-file="${UNLISTED}" data-kind="pdf" data-title="Old CV"></figure>`
const PRIVATE_HTML = "<!doctype html><html><body>Private source</body></html>"
const PAGE = { src: "data:image/png;base64,iVBORw0KGgo=", width: 1600, height: 2071 }
const PAGE_LINKS = [{ x: 118, y: 91, w: 327, h: 25, href: "https://example.com/" }]
let scope
let debounce = (fn) => fn

afterEach(() => {
  scope?.stop()
  vi.unstubAllGlobals()
  debounce = (fn) => fn
})

// The figures of the rendered HTML, as an inert template would parse them.
const figures = (html) =>
  Array.from(html.matchAll(/<figure ([^>]*)>/g), ([, attrs]) => {
    const map = new Map(Array.from(attrs.matchAll(/([\w-]+)="([^"]*)"/g), ([, name, value]) => [name, value]))
    return { getAttribute: (name) => map.get(name) ?? null, hasAttribute: (name) => map.has(name) }
  })

function viewer(kind, fetch = async () => ({ kind: "html", content: PRIVATE_HTML }), errors) {
  const drop = ref({ id: "doc", kind, content: "", html: RENDERED })
  const sent = []
  const request = vi.fn(fetch)
  const pdfs = []
  const drawn = []
  let receive
  for (const [name, value] of Object.entries({
    computed,
    ref,
    shallowRef,
    watch,
    onScopeDispose,
    onMounted: () => {},
    useCopy: () => ({ copy: () => {} }),
    useColorMode: () => ref("dark"),
    useMounted: () => ref(true),
    useBase64: () => ({ base64: ref("") }),
    useAttachmentData: () => ({
      ready: ref(true),
      deferred: ref(false),
      inline: (html) => html,
      pdfs: ref([ATTACHED]),
      pdfsLeftOut: ref([UNLISTED]),
    }),
    useDocEmbeds,
    useDebounceFn: (fn) => debounce(fn),
    useEventListener: () => {},
    useViewerQuiz: () => ({ receive: () => {} }),
    useDropFrame: (_frame, _origin, handler) => {
      receive = handler
      return { ready: ref(false), send: (message) => sent.push(message) }
    },
    reportClientError: () => {},
    // pdf.js and FileReader live in the browser (test/viewer/pdf-pages-browser.test.mjs covers pdf-pages).
    openPdf: async (src) => {
      const pdf = { src, numPages: src.includes("long") ? 42 : 2, loadingTask: { destroy: vi.fn(async () => {}) } }
      pdfs.push(pdf)
      return pdf
    },
    renderPage: async (pdf, page) => {
      drawn.push(page)
      if (pdf.src.includes("broken")) throw new Error("Invalid page content")
      return { ...PAGE, page }
    },
    pageLinks: async () => PAGE_LINKS,
    blobDataUrl: async (blob) => `data:${blob.type};base64,${Buffer.from(await blob.text()).toString("base64")}`,
    // The browser parses the trusted rendered HTML in an inert template, never the frame's requested links.
    document: {
      createElement: (tag) => {
        assert.equal(tag, "template")
        const template = {
          innerHTML: "",
          content: {
            querySelectorAll: (selector) => {
              assert.equal(selector, "figure.drop-embed")
              assert.equal(template.innerHTML, drop.value.html)
              return figures(template.innerHTML)
            },
          },
        }
        return template
      },
    },
    $fetch: request,
  }))
    vi.stubGlobal(name, value)
  scope = effectScope()
  scope.run(() =>
    useViewerFrame({
      drop,
      frame: ref(null),
      app: {
        files: ref({ "index.html": PRIVATE_HTML }),
        pages: ref(["index.html"]),
        page: ref("index.html"),
        location: ref("/"),
      },
      pinned: ref([]),
      inset: ref(0),
      bottom: ref(0),
      width: ref("readable"),
      annotations: {
        frameTool: ref("browse"),
        penStyle: ref({}),
        overlays: {},
        draftingArea: ref(null),
        popover: ref(null),
      },
      errors,
    }),
  )
  return { drop, sent, request, receive, pdfs, drawn }
}

test("an error the open page reports is sent for the version that threw it, and the viewer shows what Drop stored", async () => {
  const errors = ref([])
  const flushes = []
  debounce = (fn) => () => flushes.push(fn)
  const kept = [{ kind: "error", message: "TypeError: x", count: 3, lastAt: 1 }]
  const { drop, receive, request } = viewer(
    "html",
    async (_url, { body }) => (body.version === 2 ? { errors: kept } : undefined),
    errors,
  )
  drop.value = { ...drop.value, version: 2, trashedAt: null }
  const boom = { type: "runtime-error", kind: "error", message: "TypeError: x", source: "https://example.com/a.js:1:2" }
  receive(boom)
  await flushes.pop()()
  assert.deepEqual(errors.value, kept, "the list Drop stored, as read_drop shows it")
  receive({ ...boom, message: "Late" })
  drop.value = { ...drop.value, version: 3 }
  await flushes.pop()()
  assert.equal(request.mock.calls[1][1].body.version, 2, "the batch keeps the version it was reported on")
  assert.deepEqual(errors.value, kept, "the viewer moved on, so v2's list stays out")
  drop.value = { ...drop.value, version: 1 }
  receive(boom)
  await flushes.pop()()
  assert.deepEqual(errors.value, kept, "Drop stored nothing for an old version")
})

for (const kind of ["html", "app"])
  test(`${kind} frames cannot fetch another drop's source or title through the embed bridge`, async () => {
    const { receive, request, sent } = viewer(kind)
    receive({ type: "embeds", links: [LINK, OTHER_LINK, ATTACHED] })
    receive({ type: "embed-page", link: ATTACHED, page: 1 })
    await nextTick()
    assert.equal(request.mock.calls.length, 0)
    assert.deepEqual(sent, [])
  })

test("Markdown frames may fetch only links in their server-rendered embed boxes", async () => {
  const { receive, request, sent } = viewer("markdown")
  receive({ type: "embeds", links: [OTHER_LINK, LINK] })
  await vi.waitFor(() => assert.equal(sent.length, 1))
  assert.deepEqual(request.mock.calls, [[`/api/drops/${LINK}`]])
  assert.equal(sent[0].type, "embed-data")
  assert.equal(sent[0].link, LINK)
  assert.equal(sent[0].kind, "html")
  assert.ok(sent[0].html.includes("Private source"))
  assert.ok(sent[0].html.includes('classList.toggle("dark", true)'))
})

// What the viewer reads for each kind of drop, as the reader: the detail, then its file.
const DROPS = {
  pdf: { kind: "file", filename: "deck.pdf", title: "Deck", url: "https://drop.example.com/f/deck.pdf" },
  image: { kind: "image", filename: "shot.png", title: "Shot", url: "https://drop.example.com/f/shot.png" },
  video: { kind: "file", filename: "demo.mp4", title: "Demo", url: "https://drop.example.com/f/demo.mp4" },
  doc: { kind: "markdown", filename: "notes.md", title: "Notes" },
  zip: { kind: "file", filename: "data.zip", title: "Data", url: "https://drop.example.com/f/data.zip" },
}
const reader = (found, comments = []) =>
  async function (url, options) {
    if (url === `/api/drops/${LINK}`) {
      if (!found) throw new Error("Forbidden")
      return found
    }
    if (url === `/api/drops/${LINK}/comments`) return comments
    assert.deepEqual(options, { responseType: "blob" })
    return new Blob(["bytes"], { type: url.endsWith(".png") ? "image/png" : "video/mp4" })
  }

test("a doc's box answers with a PDF's page count, an image, or a video, and says which drops can show", async () => {
  const answers = {}
  for (const [name, found] of Object.entries({ ...DROPS, private: null })) {
    const { receive, sent, pdfs } = viewer("markdown", reader(found))
    receive({ type: "embeds", links: [LINK] })
    await vi.waitFor(() => assert.equal(sent.length, 1))
    const { type, link, ...data } = sent[0]
    assert.deepEqual({ type, link }, { type: "embed-data", link: LINK })
    answers[name] = data
    if (name === "pdf")
      assert.deepEqual(
        pdfs.map(({ src }) => src),
        [DROPS.pdf.url],
      )
    scope.stop()
  }
  assert.deepEqual(answers.pdf, { kind: "pdf", pages: 2, title: "Deck", href: `/d/${LINK}` })
  assert.deepEqual(answers.image, { kind: "image", src: "data:image/png;base64,Ynl0ZXM=" })
  assert.equal(answers.video.kind, "video")
  assert.equal(answers.video.mime, "video/mp4")
  assert.ok(answers.video.data instanceof Blob)
  for (const name of ["doc", "zip"])
    assert.deepEqual(answers[name], {
      error: `“${DROPS[name].title}” can't show here. Only HTML, PDF, image and video drops can show inside a doc.`,
    })
  assert.deepEqual(answers.private, { error: "This drop is private, expired, or deleted, so it can't show here." })
})

test("a PDF drop's page comes drawn, with its links and its comments on that page as pins, resolved ones marked", async () => {
  const comment = (n, fields) => ({ n, pdfPage: 2, ox: 100, oy: 200, ow: 0, oh: 0, resolved: false, ...fields })
  const comments = [
    comment(1),
    comment(2, { ow: 300, oh: 50 }),
    comment(3, { resolved: true }),
    comment(4, { pdfPage: 1 }),
    comment(5, { pdfPage: null }),
  ]
  const { receive, request, sent, pdfs } = viewer("markdown", reader(DROPS.pdf, comments))
  receive({ type: "embed-page", link: LINK, page: 2 })
  await vi.waitFor(() => assert.equal(sent.length, 1))
  assert.deepEqual(sent[0], {
    type: "embed-page-data",
    link: LINK,
    ...PAGE,
    page: 2,
    links: PAGE_LINKS,
    pins: [
      { n: 1, x: 100, y: 200 },
      { n: 2, x: 100, y: 200, w: 300, h: 50 },
      { n: 3, x: 100, y: 200, resolved: true },
    ],
  })
  // One read of the drop, its comments and its file, with the reader's session.
  assert.deepEqual(request.mock.calls.map(([url]) => url).sort(), [`/api/drops/${LINK}`, `/api/drops/${LINK}/comments`])
  assert.equal(pdfs.length, 1)
})

test("a PDF attached to the doc answers by its path, with no pins; one past the cap says so and links it", async () => {
  const { receive, request, sent, pdfs } = viewer("markdown")
  receive({ type: "embeds", links: [UNLISTED, ATTACHED, "/f/33333333-3333-4333-8333-333333333333.pdf"] })
  receive({ type: "embed-page", link: UNLISTED, page: 1 })
  await vi.waitFor(() => assert.equal(sent.length, 2))
  assert.deepEqual(
    sent.find((message) => message.link === UNLISTED),
    {
      type: "embed-data",
      link: UNLISTED,
      error: "Only the first 10 attached PDFs show inside a doc; open it: ",
      href: UNLISTED,
    },
  )
  assert.deepEqual(
    sent.find((message) => message.link === ATTACHED),
    { type: "embed-data", link: ATTACHED, kind: "pdf", pages: 2, title: "CV", href: ATTACHED },
  )
  receive({ type: "embed-page", link: ATTACHED, page: 1 })
  await vi.waitFor(() => assert.equal(sent.length, 3))
  assert.deepEqual(sent[2], { type: "embed-page-data", link: ATTACHED, ...PAGE, page: 1, links: PAGE_LINKS, pins: [] })
  assert.deepEqual(request.mock.calls, [])
  assert.deepEqual(
    pdfs.map(({ src }) => src),
    [ATTACHED],
  )
})

// A PDF drop whose file the test swaps, as a new version of it does, and whose detail can be held on its way.
function versioned() {
  const state = { url: "https://drop.example.com/f/v1.pdf", held: Promise.resolve() }
  const fetch = async (url) => {
    if (url === `/api/drops/${LINK}`) {
      const found = { ...DROPS.pdf, url: state.url }
      await state.held
      return found
    }
    if (url === `/api/drops/${LINK}/comments`) return []
    throw new Error(url)
  }
  return { state, fetch }
}

test("after a new version of an embedded PDF drop, the reloaded doc draws its pages from the new file", async () => {
  const { state, fetch } = versioned()
  const { receive, sent, pdfs } = viewer("markdown", fetch)
  receive({ type: "embeds", links: [LINK] })
  receive({ type: "embed-page", link: LINK, page: 1 })
  await vi.waitFor(() => assert.equal(sent.length, 2))
  state.url = "https://drop.example.com/f/v2.pdf"
  // The frame reloads (theme, width, zen, a new version of the doc) and asks again.
  receive({ type: "ready" })
  receive({ type: "embeds", links: [LINK] })
  receive({ type: "embed-page", link: LINK, page: 1 })
  await vi.waitFor(() => assert.equal(sent.length, 4))
  assert.deepEqual(
    pdfs.map(({ src }) => src),
    ["https://drop.example.com/f/v1.pdf", "https://drop.example.com/f/v2.pdf"],
  )
  assert.equal(sent[3].type, "embed-page-data")
})

test("an answer still on its way when the frame reloads is dropped, and the reloaded frame gets its own", async () => {
  const { state, fetch } = versioned()
  let release
  state.held = new Promise((resolve) => (release = resolve))
  const { receive, sent, pdfs } = viewer("markdown", fetch)
  receive({ type: "embeds", links: [LINK] })
  receive({ type: "embed-page", link: LINK, page: 1 })
  await new Promise((resolve) => setTimeout(resolve, 10))
  state.url = "https://drop.example.com/f/v2.pdf"
  state.held = Promise.resolve()
  receive({ type: "ready" })
  receive({ type: "embeds", links: [LINK] })
  receive({ type: "embed-page", link: LINK, page: 1 })
  await vi.waitFor(() => assert.equal(sent.length, 2))
  release()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(sent.length, 2)
  assert.deepEqual(
    sent.map(({ type, href }) => [type, href]),
    [
      ["embed-data", `/d/${LINK}`],
      ["embed-page-data", undefined],
    ],
  )
  assert.deepEqual(
    pdfs.map(({ src }) => src),
    ["https://drop.example.com/f/v2.pdf"],
  )
})

test("a new version of the doc closes the PDFs it had open", async () => {
  const { drop, receive, sent, pdfs } = viewer("markdown", reader(DROPS.pdf))
  receive({ type: "embed-page", link: LINK, page: 1 })
  await vi.waitFor(() => assert.equal(sent.length, 1))
  drop.value = { ...drop.value, version: 2 }
  await vi.waitFor(() => assert.equal(pdfs[0].loadingTask.destroy.mock.calls.length, 1))
})

test("a PDF of 42 pages draws its page 42, and the viewer closes its PDFs when the drop changes", async () => {
  const { drop, receive, sent, pdfs } = viewer(
    "markdown",
    reader({ ...DROPS.pdf, url: "https://drop.example.com/f/long.pdf" }),
  )
  // Past the last page, the last page, already on its way.
  receive({ type: "embed-page", link: LINK, page: 42 })
  receive({ type: "embed-page", link: LINK, page: 43 })
  await vi.waitFor(() => assert.equal(sent.length, 1))
  assert.equal(sent[0].page, 42)
  drop.value = { id: "next", kind: "markdown", content: "", html: "" }
  await vi.waitFor(() => assert.equal(pdfs[0].loadingTask.destroy.mock.calls.length, 1))
})

test("a page asked for again is drawn once, until the doc loads again", async () => {
  const { receive, sent, drawn } = viewer("markdown", reader(DROPS.pdf))
  receive({ type: "embed-page", link: LINK, page: 1 })
  receive({ type: "embed-page", link: LINK, page: 1 })
  await vi.waitFor(() => assert.equal(sent.length, 1))
  receive({ type: "embed-page", link: LINK, page: 1 })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(drawn, [1])
  assert.equal(sent.length, 1)
  // A new document in the frame (a new version, a reload) has none of the pages.
  receive({ type: "ready" })
  receive({ type: "embed-page", link: LINK, page: 1 })
  await vi.waitFor(() => assert.equal(sent.length, 2))
  assert.deepEqual(drawn, [1, 1])
})

test("a page the viewer can't draw answers with why, so the doc stops waiting for it", async () => {
  const { receive, sent } = viewer("markdown", reader({ ...DROPS.pdf, url: "https://drop.example.com/f/broken.pdf" }))
  receive({ type: "embed-page", link: LINK, page: 2 })
  await vi.waitFor(() => assert.equal(sent.length, 1))
  assert.deepEqual(sent[0], { type: "embed-page-data", link: LINK, page: 2, error: "Page 2 couldn't be drawn." })
})

test("a pending embed cannot deliver its source after the viewer changes to an HTML drop", async () => {
  let finish
  const { drop, receive, request, sent } = viewer("markdown", () => new Promise((resolve) => (finish = resolve)))
  receive({ type: "embeds", links: [LINK] })
  assert.equal(request.mock.calls.length, 1)
  drop.value = { id: "attacker", kind: "html", content: PRIVATE_HTML, html: "" }
  finish({ kind: "html", content: PRIVATE_HTML })
  await nextTick()
  await nextTick()
  assert.deepEqual(sent, [])
})
