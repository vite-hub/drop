import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium, webkit } from "playwright"
import { test } from "vite-plus/test"
import { PREVIEW_SANDBOX, previewSandbox } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"
import { parseFrameMessage } from "../../shared/frame-messages.ts"

// A dark Markdown doc in the viewer's frame, the way DropViewer renders one without a content origin.
async function open(browser, sandbox) {
  const html = planDocument("markdown", "# Plan", true, "<h1>Plan</h1><p>Launch on November 18.</p>")
  const escaped = html.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const page = await browser.newPage()
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "drop.test"
      ? route.fulfill({
          contentType: "text/html",
          body: `<iframe sandbox="${sandbox}" srcdoc="${escaped}"></iframe>
            <script>window.posts = []; addEventListener("message", (e) => { if (e.data?.__drop) window.posts.push(e.data); });
              window.tell = (message) => frames[0].postMessage({ __drop: true, ...message }, "*");</script>`,
        })
      : route.abort(),
  )
  await page.goto("https://drop.test/")
  await page.waitForFunction(() => window.posts.some((m) => m.type === "ready"))
  const frame = page.frames()[1]
  // What the page looks like as it prints: this listener runs after the runtime's own beforeprint.
  await frame.evaluate(() => {
    window.printed = []
    addEventListener("beforeprint", () =>
      window.printed.push({
        at: Date.now(),
        title: document.title,
        dark: document.documentElement.classList.contains("dark"),
      }),
    )
  })
  return { page, frame }
}

test("Export as PDF prints a Markdown doc light, under the drop's title, without Drop's pins", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, previewSandbox("markdown"))
    await page.evaluate(() => window.tell({ type: "print", title: "SEO plan" }))
    await frame.waitForFunction(() => window.printed.length > 0)
    const [printed] = await frame.evaluate(() => window.printed)
    assert.equal(printed.title, "SEO plan")
    assert.equal(printed.dark, false)
    // Back to the reader's dark mode once the dialog closes.
    await frame.waitForFunction(() => document.documentElement.classList.contains("dark"))

    await page.emulateMedia({ media: "print" })
    assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector("drop-comments")).display), "none")
  } finally {
    await browser.close()
  }
})

// A doc script's own wait on Export as PDF: `steps` are [ms, "progress" | "settle"] from the moment it starts.
async function waitOn(frame, steps) {
  await frame.evaluate((steps) => {
    document.addEventListener("drop:print", (e) => {
      window.started = Date.now()
      e.detail.waitUntil(
        new Promise((resolve) => {
          for (const [ms, step] of steps)
            setTimeout(() => {
              window.last = Date.now()
              if (step === "settle") resolve()
              else e.detail.progress()
            }, ms)
        }),
      )
    })
  }, steps)
}

test("Export as PDF prints soon after the last wait settles", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, previewSandbox("markdown"))
    await waitOn(frame, [
      [400, "progress"],
      [800, "progress"],
      [1_500, "settle"],
    ])
    await page.evaluate(() => window.tell({ type: "print", title: "SEO plan" }))
    await frame.waitForFunction(() => window.printed.length > 0, null, { timeout: 5_000 })
    const after = await frame.evaluate(() => Date.now() - window.last)
    assert.ok(after < 1_000, `printed ${after} ms after the wait settled`)
  } finally {
    await browser.close()
  }
})

test("Export as PDF keeps waiting while a wait makes progress and prints 10 s after it stalls", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, previewSandbox("markdown"))
    await waitOn(frame, [
      [3_000, "progress"],
      [6_000, "progress"],
    ])
    await page.evaluate(() => window.tell({ type: "print", title: "SEO plan" }))
    await frame.waitForFunction(() => window.printed.length > 0, null, { timeout: 25_000 })
    const { started, last } = await frame.evaluate(() => ({ started: window.started, last: window.last }))
    const [printed] = await frame.evaluate(() => window.printed)
    assert.equal(last - started >= 6_000, true)
    assert.ok(
      printed.at - last >= 9_500 && printed.at - last < 12_000,
      `printed ${printed.at - last} ms after the last progress`,
    )
  } finally {
    await browser.close()
  }
}, 40_000)

test("other drops' frames can't open the print dialog", async () => {
  assert.equal(previewSandbox("html"), PREVIEW_SANDBOX)
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, PREVIEW_SANDBOX)
    await page.evaluate(() => window.tell({ type: "print", title: "SEO plan" }))
    await page.waitForTimeout(300)
    assert.deepEqual(await frame.evaluate(() => window.printed), [])
  } finally {
    await browser.close()
  }
})

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
const PENDING = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
const NEAR = "/f/00000000-0000-4000-8000-000000000001.png"
const FAR = "/f/00000000-0000-4000-8000-000000000002.png"
const LINK = "k7f2q9m4x8wd"
const FILLER = "<p>Launch on November 18.</p>".repeat(30)

// A one-frame WebM without a poster, as an attached video arrives.
const WEBM =
  "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAIBEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggHr7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjIuMy4xMDBXQYxMYXZmNjIuMy4xMDBEiYhAaQAAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIr0zgQ21aKuucgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QL68IA4JCwgSC6gRiagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYyLjMuMTAwc3PWY8CLY8WIr0zgQ21aKutnyKFFo4dFTkNPREVSRIeUTGF2YzYyLjExLjEwMCBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAwLjIwMDAwMDAwMAAfQ7Z1w+eBAKO+gQAAgBADAJ0BKiAAGAAARwiFhYiFhIgCAgJ1qgP4A/oCCFkMvQD+/W7z/+OZNzDE/45t//FhPA4oyP/xUQAcU7trkbuPs4EAt4r3gQHxggGj8IED"

// A doc whose first image is on screen, a second one about five screens down and another drop's box further still,
// in a frame of one screen.
const LAZY_DOC =
  `<h1>Plan</h1><p><img src="${PENDING}" data-drop-image="${NEAR}" alt="near"></p>${FILLER.repeat(5)}` +
  `<p><img src="${PENDING}" data-drop-image="${FAR}" alt="far"></p>${FILLER.repeat(2)}` +
  `<figure class="drop-embed" data-drop-embed="${LINK}" data-title="Steps"><a class="drop-embed-link" href="/d/${LINK}">Steps</a></figure>`

// The viewer around `doc`: it drops what the real parser rejects, and answers `files` and `embeds` after a pause
// when `answers` names them. A path in `videos` gets the WebM, or `"broken"` bytes no browser plays. `onRequest`
// sees every other request to drop.test, such as an embedded drop's images.
async function openLazy(
  browser,
  { answers, doc = LAZY_DOC, videos = {}, embed = "<!doctype html><p>Steps</p>", onRequest },
) {
  const answering = answers === true ? { files: true, embeds: true } : answers || {}
  const html = planDocument("markdown", "", false, doc)
  const escaped = html.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await page.exposeFunction("parseFrameMessage", (message) => parseFrameMessage(message) !== null)
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url())
    // WebKit routes the frame's own blob: URLs too.
    if (url.protocol === "blob:") return route.continue()
    if (url.hostname !== "drop.test") return route.abort()
    if (url.pathname !== "/") return onRequest(route, url)
    return route.fulfill({
      contentType: "text/html",
      body: `<style>body{margin:0}iframe{border:0;width:100vw;height:700px;display:block}</style>
            <iframe sandbox="${previewSandbox("markdown")}" srcdoc="${escaped}"></iframe>
            <script>window.posts = []; window.rejected = []; window.delivered = [];
              const answering = ${JSON.stringify(answering)};
              const videos = ${JSON.stringify(videos)};
              const video = (kind) => kind === "broken"
                ? new Blob(["not a video"], { type: "video/webm" })
                : new Blob([Uint8Array.from(atob(${JSON.stringify(WEBM)}), (c) => c.charCodeAt(0))], { type: "video/webm" });
              const answer = (source, message) => setTimeout(() => {
                window.delivered.push(message.path || message.link);
                source.postMessage({ __drop: true, ...message }, "*");
              }, 600);
              addEventListener("message", async (e) => {
                if (!e.data?.__drop) return;
                const source = e.source;
                if (!(await window.parseFrameMessage(e.data))) return window.rejected.push(e.data);
                window.posts.push(e.data);
                if (e.data.type === "files" && answering.files) for (const path of e.data.paths)
                  answer(source, { type: "file-data", path, data: videos[path] ? video(videos[path]) : ${JSON.stringify(PNG)} });
                // An attached PDF has one page; any other link is an HTML drop.
                if (e.data.type === "embeds" && answering.embeds) for (const link of e.data.links)
                  answer(source, link.startsWith("/f/")
                    ? { type: "embed-data", link, kind: "pdf", pages: 1, title: "CV", href: link }
                    : { type: "embed-data", link, html: ${JSON.stringify(embed).replaceAll("<", "\\u003c")} });
                if (e.data.type === "embed-page" && answering.embeds)
                  answer(source, { type: "embed-page-data", link: e.data.link, page: e.data.page, src: ${JSON.stringify(PNG)}, width: 1240, height: 1605, links: [], pins: [] });
              });
              window.tell = (message) => frames[0].postMessage({ __drop: true, ...message }, "*");</script>`,
    })
  })
  await page.goto("https://drop.test/")
  await page.waitForFunction(() => window.posts.some((m) => m.type === "ready"))
  const frame = page.frames()[1]
  await frame.evaluate(() => {
    window.printed = []
    window.framesLoaded = 0
    // Load doesn't bubble, but the document sees it on the way down.
    document.addEventListener("load", (e) => e.target.tagName === "IFRAME" && window.framesLoaded++, true)
    addEventListener("beforeprint", () =>
      window.printed.push({
        at: Date.now(),
        placeholders: document.querySelectorAll("img[data-drop-image]").length,
        unfilled: document.querySelectorAll("[data-drop-embed]").length,
        frames: document.querySelectorAll(".drop-embed iframe").length,
        framesLoaded: window.framesLoaded,
        pages: document.querySelectorAll(".drop-embed-page > img").length,
        images: [...document.images].map((image) => ({
          alt: image.alt,
          drawn: image.complete && image.naturalWidth > 0,
        })),
        videos: [...document.querySelectorAll("video")].map((video) => ({
          title: video.title,
          readyState: video.readyState,
          width: video.videoWidth,
          preload: video.getAttribute("preload"),
        })),
      }),
    )
  })
  return { page, frame }
}

const asked = (posts) => ({
  files: posts
    .filter((m) => m.type === "files")
    .flatMap((m) => m.paths)
    .sort(),
  embeds: posts.filter((m) => m.type === "embeds").flatMap((m) => m.links),
})

test("Export as PDF asks for the files and drops further down and prints once they're on the page", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await openLazy(browser, { answers: true })
    // Only what's near the screen is asked for while reading.
    assert.deepEqual(asked(await page.evaluate(() => window.posts)), { files: [NEAR], embeds: [] })

    await page.evaluate(() => window.tell({ type: "print", title: "SEO plan" }))
    await frame.waitForFunction(() => window.printed.length > 0, null, { timeout: 10_000 })
    assert.deepEqual(asked(await page.evaluate(() => window.posts)), { files: [FAR, NEAR].sort(), embeds: [LINK] })
    const [printed] = await frame.evaluate(() => window.printed)
    assert.deepEqual(
      { placeholders: printed.placeholders, unfilled: printed.unfilled, frames: printed.frames },
      { placeholders: 0, unfilled: 0, frames: 1 },
    )
    assert.deepEqual((await page.evaluate(() => window.delivered)).sort(), [FAR, LINK, NEAR].sort())
    assert.equal(await frame.evaluate(() => document.title), "SEO plan")
  } finally {
    await browser.close()
  }
}, 30_000)

test("Export as PDF still prints when the viewer never sends the files", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await openLazy(browser, { answers: false })
    const sent = await frame.evaluate(() => Date.now())
    await page.evaluate(() => window.tell({ type: "print", title: "SEO plan" }))
    await page.waitForTimeout(1_000)
    assert.deepEqual(await frame.evaluate(() => window.printed), [])
    assert.deepEqual(asked(await page.evaluate(() => window.posts)), { files: [FAR, NEAR].sort(), embeds: [LINK] })

    await frame.waitForFunction(() => window.printed.length > 0, null, { timeout: 25_000 })
    const [printed] = await frame.evaluate(() => window.printed)
    assert.ok(printed.at - sent >= 9_500 && printed.at - sent < 13_000, `printed after ${printed.at - sent} ms`)
    assert.equal(printed.placeholders, 2)
  } finally {
    await browser.close()
  }
}, 40_000)

// A doc with an attached PDF at the top and a PDF drop far below. The viewer answers each page after a pause, and
// answers the pages in `failing` with the reason it couldn't draw them.
async function openPdfs(browser, { pages, failing = [] }) {
  const CV = "/f/00000000-0000-4000-8000-000000000003.pdf"
  const html = planDocument(
    "markdown",
    "",
    false,
    `<h1>Plan</h1><figure class="drop-embed" data-drop-file="${CV}" data-kind="pdf" data-title="CV"><a class="drop-embed-link" href="${CV}">CV</a></figure>` +
      `${FILLER.repeat(5)}<figure class="drop-embed" data-drop-embed="${LINK}" data-title="Deck"><a class="drop-embed-link" href="/d/${LINK}">Deck</a></figure>`,
  )
  const escaped = html.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "drop.test"
      ? route.fulfill({
          contentType: "text/html",
          body: `<style>body{margin:0}iframe{border:0;width:100vw;height:700px;display:block}</style>
          <iframe sandbox="${previewSandbox("markdown")}" srcdoc="${escaped}"></iframe>
          <script>window.posts = []; window.answered = 0;
            const pages = { ${JSON.stringify(CV)}: ${pages[0]}, ${JSON.stringify(LINK)}: ${pages[1]} };
            const failing = ${JSON.stringify(failing)};
            const answer = (source, message) => setTimeout(() => {
              window.answered = Date.now();
              source.postMessage({ __drop: true, ...message }, "*");
            }, 150);
            addEventListener("message", (e) => {
              if (!e.data?.__drop) return;
              window.posts.push(e.data);
              const { link, page } = e.data;
              if (e.data.type === "embeds") for (const link of e.data.links)
                answer(e.source, { type: "embed-data", link, kind: "pdf", pages: pages[link], title: "Deck", href: "/d/" + link });
              if (e.data.type !== "embed-page") return;
              if (failing.includes(page)) answer(e.source, { type: "embed-page-data", link, page, error: "Bad page" });
              else answer(e.source, { type: "embed-page-data", link, page, src: ${JSON.stringify(PNG)}, width: 1240, height: 1605, links: [], pins: [] });
            });
            window.tell = (message) => frames[0].postMessage({ __drop: true, ...message }, "*");</script>`,
        })
      : route.abort(),
  )
  await page.goto("https://drop.test/")
  await page.waitForFunction(() => window.posts.some((m) => m.type === "ready"))
  const frame = page.frames()[1]
  // While reading, only the pages near the screen are asked for.
  await page.waitForFunction(() => window.posts.some((m) => m.type === "embed-page"))
  await page.waitForTimeout(500)
  const read = await page.evaluate(() => window.posts.filter((m) => m.type === "embed-page").length)
  assert.ok(read < 10, `${read} pages asked for while reading`)
  await frame.evaluate(() => {
    window.printed = []
    addEventListener("beforeprint", () =>
      window.printed.push({
        at: Date.now(),
        pages: Array.from(document.querySelectorAll(".drop-embed"), (box) => [
          box.querySelectorAll(".drop-embed-page > img").length,
          box.querySelectorAll(".drop-embed-page > .drop-embed-note").length,
        ]),
        notes: Array.from(document.querySelectorAll(".drop-embed-page > .drop-embed-note"), (note) => note.textContent),
      }),
    )
  })
  return { page, frame }
}

const pagesAsked = (posts) => posts.filter((m) => m.type === "embed-page").map((m) => `${m.link} ${m.page}`)

test("Export as PDF draws every page of a doc's PDFs, all 42 of a long one, and asks for each page once", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await openPdfs(browser, { pages: [6, 42] })
    await page.evaluate(() => window.tell({ type: "print", title: "Plan" }))
    await frame.waitForFunction(() => window.printed.length > 0, null, { timeout: 20_000 })
    const [printed] = await frame.evaluate(() => window.printed)
    assert.deepEqual(printed.pages, [
      [6, 0],
      [42, 0],
    ])
    const posts = pagesAsked(await page.evaluate(() => window.posts))
    assert.equal(posts.length, 48)
    assert.equal(new Set(posts).size, 48)
    await page.emulateMedia({ media: "print" })
    // Only the page images print: no box background or border to band a Letter page on A4. Drop's colors from disk,
    // since `vp test` leaves THEME_CSS empty.
    const theme = await readFile(new URL("../../shared/theme.css", import.meta.url), "utf8")
    await frame.evaluate((css) => {
      const style = document.createElement("style")
      style.textContent = css
      document.head.prepend(style)
    }, theme)
    assert.deepEqual(
      await frame.evaluate(() =>
        [".drop-embed", ".drop-embed-page"].map((selector) => {
          const style = getComputedStyle(document.querySelector(selector))
          return [style.backgroundColor, style.borderTopWidth, style.backgroundImage]
        }),
      ),
      [
        ["rgba(0, 0, 0, 0)", "0px", "none"],
        ["rgba(0, 0, 0, 0)", "0px", "none"],
      ],
    )
    assert.equal(
      await frame.evaluate(() => getComputedStyle(document.querySelector(".drop-embed-page")).breakInside),
      "avoid",
    )
  } finally {
    await browser.close()
  }
}, 40_000)

test("Export as PDF asks for a long doc's files and drops in batches the viewer accepts", async () => {
  const paths = Array.from(
    { length: 101 },
    (_, i) => `/f/00000000-0000-4000-8000-${String(i + 10).padStart(12, "0")}.png`,
  )
  const links = Array.from({ length: 21 }, (_, i) => `k7f2q9m4x${String(i).padStart(3, "0")}`)
  const doc =
    `<h1>Plan</h1>${FILLER.repeat(3)}` +
    paths.map((path) => `<p><img src="${PENDING}" data-drop-image="${path}" alt=""></p>`).join("") +
    links.map((link) => `<figure class="drop-embed" data-drop-embed="${link}"></figure>`).join("")
  const browser = await chromium.launch()
  try {
    const { page, frame } = await openLazy(browser, { answers: true, doc })
    await page.evaluate(() => window.tell({ type: "print", title: "SEO plan" }))
    await frame.waitForFunction(() => window.printed.length > 0, null, { timeout: 20_000 })
    assert.deepEqual(await page.evaluate(() => window.rejected), [])
    assert.deepEqual(asked(await page.evaluate(() => window.posts)), { files: [...paths].sort(), embeds: links })
    const [printed] = await frame.evaluate(() => window.printed)
    assert.deepEqual(
      { placeholders: printed.placeholders, unfilled: printed.unfilled, framesLoaded: printed.framesLoaded },
      { placeholders: 0, unfilled: 0, framesLoaded: 21 },
    )
  } finally {
    await browser.close()
  }
}, 40_000)

test("Export as PDF asks for 10 attached PDFs and 11 drops below the screen in batches the viewer accepts", async () => {
  const pdfs = Array.from(
    { length: 10 },
    (_, i) => `/f/00000000-0000-4000-8000-${String(i + 200).padStart(12, "0")}.pdf`,
  )
  const links = Array.from({ length: 11 }, (_, i) => `k7f2q9m4x${String(i).padStart(3, "0")}`)
  const doc =
    `<h1>Plan</h1>${FILLER.repeat(3)}` +
    pdfs.map((path) => `<figure class="drop-embed" data-drop-file="${path}" data-kind="pdf"></figure>`).join("") +
    links.map((link) => `<figure class="drop-embed" data-drop-embed="${link}"></figure>`).join("")
  const browser = await chromium.launch()
  try {
    const { page, frame } = await openLazy(browser, { answers: true, doc })
    assert.deepEqual(asked(await page.evaluate(() => window.posts)).embeds, [])
    await page.evaluate(() => window.tell({ type: "print", title: "SEO plan" }))
    await frame.waitForFunction(() => window.printed.length > 0, null, { timeout: 20_000 })
    assert.deepEqual(await page.evaluate(() => window.rejected), [])
    const posts = await page.evaluate(() => window.posts)
    assert.deepEqual(asked(posts).embeds, [...pdfs, ...links])
    assert.ok(posts.filter((m) => m.type === "embeds").every((m) => m.links.length <= 20))
    const [printed] = await frame.evaluate(() => window.printed)
    assert.deepEqual(
      { unfilled: printed.unfilled, framesLoaded: printed.framesLoaded, pages: printed.pages },
      { unfilled: 0, framesLoaded: 11, pages: 10 },
    )
  } finally {
    await browser.close()
  }
}, 40_000)

test("Export as PDF prints each page of a tall PDF whole on a sheet of its own", async () => {
  const CV = "/f/00000000-0000-4000-8000-000000000003.pdf"
  // The doc as it prints: Chromium lays out the top-level page for page.pdf(), so the doc is the page, and the viewer's
  // answers come from the doc's own window, which is its `parent`.
  const html = planDocument(
    "markdown",
    "",
    false,
    `<h1>Plan</h1><p>Launch on November 18.</p><figure class="drop-embed" data-drop-file="${CV}" data-kind="pdf" data-title="CV"><a class="drop-embed-link" href="${CV}">CV</a></figure>`,
  )
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(html)
    await page.evaluate(
      ({ CV, PNG }) => {
        const tell = (message) => window.postMessage({ __drop: true, ...message }, "*")
        tell({ type: "embed-data", link: CV, kind: "pdf", pages: 2, title: "CV", href: CV })
        // Pages twice as tall as they're wide.
        for (const n of [1, 2])
          tell({ type: "embed-page-data", link: CV, page: n, src: PNG, width: 1000, height: 2000, links: [], pins: [] })
      },
      { CV, PNG },
    )
    await page.waitForFunction(() => document.querySelectorAll(".drop-embed-page > img").length === 2)
    const pdf = await page.pdf({ format: "Letter" })
    const lib = await import("pdfjs-dist/legacy/build/pdf.mjs")
    const printed = await lib.getDocument({ data: new Uint8Array(pdf) }).promise
    // The PDF pages drawn on each sheet: one split across two sheets would be drawn on both.
    const sheets = []
    for (let n = 1; n <= printed.numPages; n++) {
      const { fnArray } = await (await printed.getPage(n)).getOperatorList()
      sheets.push(fnArray.filter((fn) => fn === lib.OPS.paintImageXObject).length)
    }
    assert.deepEqual(sheets, [0, 1, 1])
  } finally {
    await browser.close()
  }
}, 30_000)

test("Export as PDF prints right after a page the viewer couldn't draw, which says so in its place", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await openPdfs(browser, { pages: [2, 4], failing: [3] })
    await page.evaluate(() => window.tell({ type: "print", title: "Plan" }))
    await frame.waitForFunction(() => window.printed.length > 0, null, { timeout: 20_000 })
    const [printed] = await frame.evaluate(() => window.printed)
    const answered = await page.evaluate(() => window.answered)
    assert.ok(printed.at - answered < 2_000, `printed ${printed.at - answered} ms after the last answer`)
    assert.deepEqual(printed.pages, [
      [2, 0],
      [3, 1],
    ])
    assert.deepEqual(printed.notes, ["Page 3 couldn't be drawn."])
  } finally {
    await browser.close()
  }
}, 40_000)

test("Export as PDF waits for an embedded video's first frame", async () => {
  const VIDEO = "mp4vmp4vmp4v"
  const html = planDocument(
    "markdown",
    "",
    false,
    `<h1>Plan</h1>${FILLER.repeat(5)}<figure class="drop-embed" data-drop-embed="${VIDEO}" data-title="Demo"><a class="drop-embed-link" href="/d/${VIDEO}">Demo</a></figure>`,
  )
  const escaped = html.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
    // A tenth of a second of silent 8 kHz WAV, which a video element plays.
    await page.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "drop.test"
        ? route.fulfill({
            contentType: "text/html",
            body: `<iframe sandbox="${previewSandbox("markdown")}" srcdoc="${escaped}"></iframe>
            <script>window.posts = [];
              const wav = () => {
                const samples = 800, view = new DataView(new ArrayBuffer(44 + samples));
                const text = (at, value) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
                text(0, "RIFF"); view.setUint32(4, 36 + samples, true); text(8, "WAVEfmt ");
                view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
                view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
                text(36, "data"); view.setUint32(40, samples, true);
                for (let i = 0; i < samples; i++) view.setUint8(44 + i, 128);
                return new Blob([view.buffer], { type: "audio/wav" });
              };
              addEventListener("message", (e) => {
                if (!e.data?.__drop) return;
                window.posts.push(e.data);
                if (e.data.type === "embeds") for (const link of e.data.links)
                  e.source.postMessage({ __drop: true, type: "embed-data", link, kind: "video", data: wav(), mime: "video/mp4" }, "*");
              });
              window.tell = (message) => frames[0].postMessage({ __drop: true, ...message }, "*");</script>`,
          })
        : route.abort(),
    )
    await page.goto("https://drop.test/")
    await page.waitForFunction(() => window.posts.some((m) => m.type === "ready"))
    const frame = page.frames()[1]
    await frame.evaluate(() => {
      window.printed = []
      addEventListener("beforeprint", () => {
        const video = document.querySelector(".drop-embed video")
        window.printed.push(video ? video.readyState : -1)
      })
    })
    await page.evaluate(() => window.tell({ type: "print", title: "Plan" }))
    await frame.waitForFunction(() => window.printed.length > 0, null, { timeout: 20_000 })
    const [readyState] = await frame.evaluate(() => window.printed)
    assert.ok(readyState >= 2, `printed at readyState ${readyState}`)
  } finally {
    await browser.close()
  }
}, 30_000)

test("Export as PDF waits for an attached video's first frame, and not for one that can't play", async () => {
  const PLAYS = "/f/00000000-0000-4000-8000-000000000003.webm"
  const BROKEN = "/f/00000000-0000-4000-8000-000000000004.webm"
  const doc =
    `<h1>Plan</h1>${FILLER.repeat(5)}` +
    `<p><video controls preload="metadata" title="plays" data-drop-media="${PLAYS}"></video></p>` +
    `<p><video controls preload="metadata" title="broken" data-drop-media="${BROKEN}"></video></p>`
  const browser = await chromium.launch()
  try {
    const { page, frame } = await openLazy(browser, {
      answers: true,
      doc,
      videos: { [PLAYS]: "webm", [BROKEN]: "broken" },
    })
    const sent = await frame.evaluate(() => Date.now())
    await page.evaluate(() => window.tell({ type: "print", title: "SEO plan" }))
    await frame.waitForFunction(() => window.printed.length > 0, null, { timeout: 20_000 })
    const [printed] = await frame.evaluate(() => window.printed)
    const plays = printed.videos.find((video) => video.title === "plays")
    assert.ok(plays.readyState >= 2 && plays.width > 0, `printed a video at readyState ${plays.readyState}`)
    assert.ok(printed.at - sent < 8_000, `printed after ${printed.at - sent} ms`)
  } finally {
    await browser.close()
  }
}, 30_000)

// Comark renders an attached video with preload="metadata", where Safari stops before the first frame. WebKit on
// Linux shows that stop only for preload="none", so the video that arrives while reading stands in for it.
test("Export as PDF asks a video that stopped before its first frame for the rest of the file", async () => {
  const READING = "/f/00000000-0000-4000-8000-000000000005.webm"
  const PRINTING = "/f/00000000-0000-4000-8000-000000000006.webm"
  const doc =
    `<h1>Plan</h1><p><video controls preload="none" title="reading" data-drop-media="${READING}"></video></p>` +
    `${FILLER.repeat(5)}<p><video controls preload="metadata" title="printing" data-drop-media="${PRINTING}"></video></p>`
  const browser = await webkit.launch()
  try {
    const { page, frame } = await openLazy(browser, {
      answers: { files: true },
      doc,
      videos: { [READING]: "webm", [PRINTING]: "webm" },
    })
    // Headless WebKit's print() opens nothing and fires no beforeprint.
    await frame.evaluate(() => {
      window.print = () => dispatchEvent(new Event("beforeprint"))
    })
    await page.waitForFunction((path) => window.delivered.includes(path), READING)
    await page.waitForTimeout(1_000)
    assert.equal(await frame.evaluate(() => document.querySelector("video[title=reading]").readyState), 0)

    const sent = await frame.evaluate(() => Date.now())
    await page.evaluate(() => window.tell({ type: "print", title: "SEO plan" }))
    await frame.waitForFunction(() => window.printed.length > 0, null, { timeout: 20_000 })
    const [printed] = await frame.evaluate(() => window.printed)
    for (const video of printed.videos) {
      assert.ok(video.readyState >= 2 && video.width > 0, `printed ${video.title} at readyState ${video.readyState}`)
      assert.equal(video.preload, "auto")
    }
    assert.ok(printed.at - sent < 8_000, `printed after ${printed.at - sent} ms`)
  } finally {
    await browser.close()
  }
}, 40_000)

test("Export as PDF waits for every copy of a drop embedded twice", async () => {
  let images = 0
  const doc =
    `<h1>Plan</h1>${FILLER.repeat(3)}` +
    `<figure class="drop-embed" data-drop-embed="${LINK}"></figure><figure class="drop-embed" data-drop-embed="${LINK}"></figure>`
  const browser = await chromium.launch()
  try {
    const { page, frame } = await openLazy(browser, {
      answers: true,
      doc,
      // Each copy loads its own image, and the second copy's takes 2 s.
      embed: `<!doctype html><p>Steps</p><script>document.write('<img src="https://drop.test/step.png?' + Math.random() + '">')</script>`,
      onRequest: (route) => {
        const fulfill = () =>
          route.fulfill({ contentType: "image/png", body: Buffer.from(PNG.split(",")[1], "base64") })
        if (images++ === 0) fulfill()
        else setTimeout(fulfill, 2_000)
      },
    })
    await page.evaluate(() => window.tell({ type: "print", title: "SEO plan" }))
    await frame.waitForFunction(() => window.printed.length > 0, null, { timeout: 20_000 })
    assert.deepEqual(asked(await page.evaluate(() => window.posts)).embeds, [LINK])
    const [printed] = await frame.evaluate(() => window.printed)
    assert.deepEqual({ frames: printed.frames, framesLoaded: printed.framesLoaded }, { frames: 2, framesLoaded: 2 })
  } finally {
    await browser.close()
  }
}, 30_000)

test("Export as PDF draws a lazy image that came even when a drop never does", async () => {
  const doc =
    `<h1>Plan</h1>${FILLER.repeat(5)}` +
    `<p><img loading="lazy" src="${PENDING}" data-drop-image="${FAR}" alt="far"></p>${FILLER.repeat(5)}` +
    `<figure class="drop-embed" data-drop-embed="${LINK}"></figure>`
  const browser = await chromium.launch()
  try {
    const { page, frame } = await openLazy(browser, { answers: { files: true }, doc })
    await page.evaluate(() => window.tell({ type: "print", title: "SEO plan" }))
    await frame.waitForFunction(() => window.printed.length > 0, null, { timeout: 25_000 })
    const [printed] = await frame.evaluate(() => window.printed)
    assert.equal(printed.unfilled, 1)
    assert.deepEqual(
      printed.images.find((image) => image.alt === "far"),
      { alt: "far", drawn: true },
    )
  } finally {
    await browser.close()
  }
}, 40_000)
