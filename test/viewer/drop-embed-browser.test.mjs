import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { beforeEach, test } from "vite-plus/test"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"
import { embedDocument } from "../../shared/plan-runtime.ts"
import { migrate, reset } from "../cost/harness.mjs"

const { renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

migrate()
beforeEach(reset)

// A widget like the steps figure that started this: one HTML file whose script draws, and that stores a setting.
const WIDGET = `<!doctype html><html><head><title>Steps</title></head><body><p id="out">not run</p><script>
  localStorage.setItem("step", "2");
  document.getElementById("out").textContent = "ran on " + location.origin + ", step " + localStorage.getItem("step");
</script></body></html>`

test("a drop's box asks the viewer for its drop and runs it in a sandbox of its own, or shows why it can't", async () => {
  // `::drop` is how docs published before `::embed` showed drops.
  const { html } = await renderMarkdownCached(
    "embed-browser.md",
    async () =>
      '# Doc\n\n::embed{url="https://drop.vitehub.dev/d/k7f2q9m4x8wd" height=300}\n::\n\n::drop{link=a1b2c3d4e5f6}\n::\n',
  )
  const srcdoc = planDocument("markdown", "", true, html).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const answers = {
    k7f2q9m4x8wd: { html: embedDocument(WIDGET, true) },
    a1b2c3d4e5f6: { error: "This drop is private, expired, or deleted, so it can't show here." },
  }

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 900, height: 900 } })
    await context.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "drop.test"
        ? route.fulfill({
            contentType: "text/html",
            body: `<style>body{margin:0}iframe{border:0;width:100vw;height:880px;display:block}</style>
              <iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${srcdoc}"></iframe>
              <script>const answers = ${JSON.stringify(answers).replaceAll("<", "\\u003c")}; window.asked = [];
              addEventListener("message", (e) => {
                if (e.data?.__drop !== true || e.data.type !== "embeds") return;
                for (const link of e.data.links) {
                  asked.push(link);
                  e.source.postMessage({ __drop: true, type: "embed-data", link, ...answers[link] }, "*");
                }
              });</script>`,
          })
        : route.abort(),
    )
    const page = await context.newPage()
    await page.goto("https://drop.test/")
    const doc = page.frames()[1]
    await doc.waitForSelector(".drop-embed iframe", { timeout: 5000 })
    assert.deepEqual((await page.evaluate(() => asked)).sort(), ["a1b2c3d4e5f6", "k7f2q9m4x8wd"])

    const frame = await doc.$eval(".drop-embed iframe", (element) => ({
      sandbox: element.getAttribute("sandbox"),
      height: element.getBoundingClientRect().height,
    }))
    assert.deepEqual(frame, { sandbox: "allow-scripts", height: 300 })

    const widget = page.frames().find((candidate) => candidate.parentFrame() === doc)
    await widget.waitForFunction(() => document.getElementById("out").textContent !== "not run")
    // An opaque origin: the drop's script runs and keeps its storage, but has no origin to reach Drop from.
    assert.equal(await widget.textContent("#out"), "ran on null, step 2")
    assert.equal(await widget.evaluate(() => document.documentElement.classList.contains("dark")), true)

    assert.equal(
      await doc.textContent(".drop-embed .drop-embed-note"),
      "This drop is private, expired, or deleted, so it can't show here.",
    )
  } finally {
    await browser.close()
  }
}, 30_000)

const PDF = "pdf2pdf2pdf2"
const LONG = "pdf9pdf9pdf9"
const HUGE = "pdfhpdfhpdfh"
const IMAGE = "png2png2png2"
const VIDEO = "mp4vmp4vmp4v"
const CV = "/f/11111111-1111-4111-8111-111111111111.pdf"
const CV_PAST_CAP = "/f/22222222-2222-4222-8222-222222222222.pdf"
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

test("a PDF, image or video drop and an attached PDF show in the doc's flow, the PDF's pages with links and pins", async () => {
  const embed = (link) => `::embed{url="https://drop.vitehub.dev/d/${link}"}\n::\n\n`
  const { html } = await renderMarkdownCached(
    "embed-kinds-browser.md",
    async () =>
      `# Doc\n\n![CV](${CV})\n\n${embed(PDF)}${embed(IMAGE)}${embed(VIDEO)}${embed(LONG)}${embed(HUGE)}![Letter](${CV_PAST_CAP})\n`,
  )
  const srcdoc = planDocument("markdown", "", false, html).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  // The viewer's answers (useDocEmbeds): the PDFs' page counts, the image as a data: URL, the video's bytes, and each
  // page as an image 1600 pixels wide with a link and, on the PDF drop's first page, two comments.
  const answers = {
    [CV]: { kind: "pdf", pages: 1, title: "CV", href: CV },
    [PDF]: { kind: "pdf", pages: 2, title: "Deck", href: `/d/${PDF}` },
    [LONG]: { kind: "pdf", pages: 42, title: "Handbook", href: `/d/${LONG}` },
    [HUGE]: { kind: "pdf", pages: 640, title: "Archive", href: `/d/${HUGE}` },
    [IMAGE]: { kind: "image", src: PNG },
    [CV_PAST_CAP]: { error: "Only the first 10 attached PDFs show inside a doc; open it: ", href: CV_PAST_CAP },
  }
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
    await page.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "drop.test"
        ? route.fulfill({
            contentType: "text/html",
            body: `<style>body{margin:0}iframe{border:0;width:100vw;height:880px;display:block}</style>
              <iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${srcdoc}"></iframe>
              <script>const answers = ${JSON.stringify(answers)}; window.posts = [];
              addEventListener("message", (e) => {
                const m = e.data;
                if (m?.__drop !== true) return;
                posts.push(m);
                const reply = (message) => e.source.postMessage({ __drop: true, ...message }, "*");
                if (m.type === "embeds") for (const link of m.links)
                  reply({ type: "embed-data", link, ...(answers[link] ?? { kind: "video", data: new Blob(["mp4"], { type: "video/mp4" }), mime: "video/mp4" }) });
                if (m.type === "embed-page") reply({
                  type: "embed-page-data", link: m.link, page: m.page, src: ${JSON.stringify(PNG)}, width: 1600, height: 2071,
                  links: [{ x: 118, y: 91, w: 327, h: 25, href: "https://example.com/" }],
                  pins: m.link === "${PDF}" && m.page === 1 ? [{ n: 1, x: 500, y: 500 }, { n: 2, x: 100, y: 200, w: 300, h: 50 }, { n: 3, x: 700, y: 300, w: 100, h: 100, resolved: true }] : [],
                });
              });</script>`,
          })
        : route.abort(),
    )
    await page.goto("https://drop.test/")
    const doc = page.frames()[1]
    // The boxes in the doc's order (a filled drop box no longer says its link).
    const box = (link) =>
      `article > figure.drop-embed:nth-of-type(${[CV, PDF, IMAGE, VIDEO, LONG, HUGE, CV_PAST_CAP].indexOf(link) + 1})`
    const pdf = await doc.waitForSelector(`${box(PDF)}:has(img[alt="Deck, page 2"])`, { timeout: 5000 })

    assert.deepEqual(
      await pdf.evaluate((figure) => ({
        kind: figure.dataset.kind,
        frames: figure.querySelectorAll("iframe").length,
        images: Array.from(figure.querySelectorAll("img"), (img) => [
          img.alt,
          img.getAttribute("width"),
          img.getAttribute("height"),
        ]),
        // Drawn at the box's width, at the page's proportions.
        drawn: Array.from(figure.querySelectorAll("img"), (img) => [
          Math.round(img.getBoundingClientRect().width - figure.clientWidth),
          Math.round((img.getBoundingClientRect().height / img.getBoundingClientRect().width) * 1000),
        ]),
        caption: figure.querySelector("figcaption").textContent,
      })),
      {
        kind: "pdf",
        frames: 0,
        images: [
          ["Deck, page 1", "1600", "2071"],
          ["Deck, page 2", "1600", "2071"],
        ],
        drawn: [
          [0, 1294],
          [0, 1294],
        ],
        caption: "Open Deck",
      },
    )
    // The page's link covers the same part of the page drawn at the doc's width.
    const link = await pdf.evaluate((figure) => {
      const page = figure.querySelector(".drop-embed-page").getBoundingClientRect()
      const a = figure.querySelector(".drop-embed-pdf-link")
      const r = a.getBoundingClientRect()
      const at = (value, of) => Math.round((value / of) * 1000)
      return {
        href: a.href,
        target: a.target,
        rel: a.rel,
        rect: [
          at(r.left - page.left, page.width),
          at(r.top - page.top, page.height),
          at(r.width, page.width),
          at(r.height, page.height),
        ],
      }
    })
    assert.deepEqual(link, {
      href: "https://example.com/",
      target: "_blank",
      rel: "noopener noreferrer",
      rect: [118, 91, 327, 25],
    })
    // Its comments as ViewerPdf draws them: numbered pins with their sharp corner on the spot, areas outlined, resolved
    // ones greyed, each opening the PDF's drop in the viewer. Drop's colors from disk, since `vp test` leaves THEME_CSS
    // empty.
    const theme = await readFile(new URL("../../shared/theme.css", import.meta.url), "utf8")
    await doc.evaluate((css) => {
      const style = document.createElement("style")
      style.textContent = css
      document.head.prepend(style)
    }, theme)
    const pins = await pdf.evaluate((figure) => {
      const page = figure.querySelector(".drop-embed-page").getBoundingClientRect()
      const at = (r) => [
        Math.round(((r.left - page.left) / page.width) * 1000),
        Math.round(((r.top - page.top) / page.height) * 1000),
      ]
      const looks = (element) => {
        const style = getComputedStyle(element)
        return [style.opacity, style.borderTopWidth, style.borderTopLeftRadius]
      }
      return {
        pins: Array.from(figure.querySelectorAll(".drop-embed-pin"), (pin) => [
          pin.textContent,
          pin.getAttribute("href"),
          at(pin.getBoundingClientRect()),
          ...looks(pin),
          pin.getBoundingClientRect().height,
        ]),
        areas: Array.from(figure.querySelectorAll(".drop-embed-area"), (area) => [
          at(area.getBoundingClientRect()),
          ...looks(area),
        ]),
      }
    })
    assert.deepEqual(pins, {
      pins: [
        ["1", `/d/${PDF}`, [500, 500], "1", "0px", "2px", 22],
        ["2", `/d/${PDF}`, [100, 200], "1", "0px", "2px", 22],
        ["3", `/d/${PDF}`, [700, 300], "0.55", "0px", "2px", 22],
      ],
      areas: [
        [[100, 200], "1", "2px", "2px"],
        [[700, 300], "0.55", "2px", "2px"],
      ],
    })
    await pdf.evaluate((figure) => figure.querySelector(".drop-embed-pin").click())
    await page.waitForFunction(() => posts.some((m) => m.type === "doc-open"))
    assert.deepEqual(
      (await page.evaluate(() => posts)).find((m) => m.type === "doc-open"),
      { __drop: true, type: "doc-open", id: PDF },
    )
    await page.emulateMedia({ media: "print" })
    assert.equal(
      await pdf.evaluate((figure) => getComputedStyle(figure.querySelector(".drop-embed-pin")).display),
      "none",
    )
    await page.emulateMedia({ media: "screen" })

    // The attached PDF: its pages, no pins and no caption, since its comments are the doc's own.
    const cv = await doc.waitForSelector(`${box(CV)}:has(img[alt="CV, page 1"])`)
    assert.deepEqual(
      await cv.evaluate((figure) => [
        figure.querySelectorAll(".drop-embed-pin, figcaption").length,
        figure.querySelector(".drop-embed-pdf-link").href,
      ]),
      [0, "https://example.com/"],
    )

    for (const link of [IMAGE, VIDEO, LONG]) await doc.$eval(box(link), (figure) => figure.scrollIntoView())
    const image = await doc.waitForSelector(`${box(IMAGE)}[data-kind="image"] > img`)
    assert.equal(await image.getAttribute("src"), PNG)
    const video = await doc.waitForSelector(`${box(VIDEO)}[data-kind="video"] > video`)
    const first = await video.evaluate((element) => element.src)
    assert.match(await video.evaluate((element) => `${element.controls} ${element.src}`), /^true blob:/)
    // Its bytes are let go once the box shows something else.
    await page.evaluate((link) => {
      frames[0].postMessage({ __drop: true, type: "embed-data", link, error: "Gone." }, "*")
    }, VIDEO)
    await doc.waitForFunction((selector) => !document.querySelector(selector), `${box(VIDEO)} > video`)
    assert.equal(
      await doc.evaluate(
        (url) =>
          fetch(url).then(
            () => "read",
            () => "revoked",
          ),
        first,
      ),
      "revoked",
    )

    // Every page of a long PDF has its place, asked for once as it nears the screen.
    const long = await doc.waitForSelector(`${box(LONG)}[data-kind="pdf"]`)
    assert.deepEqual(
      await long.evaluate((figure) => [
        figure.querySelectorAll(".drop-embed-page").length,
        figure.querySelectorAll(".drop-embed-note").length,
      ]),
      [42, 0],
    )
    await long.evaluate((figure) => figure.querySelector(".drop-embed-page:last-of-type").scrollIntoView())
    await page.waitForFunction(
      (link) => posts.some((m) => m.type === "embed-page" && m.link === link && m.page === 42),
      LONG,
    )
    await long.evaluate((figure) => figure.querySelector(".drop-embed-page").scrollIntoView())
    await long.evaluate((figure) => figure.querySelector(".drop-embed-page:last-of-type").scrollIntoView())
    await page.waitForTimeout(300)
    const asked = await page.evaluate(() =>
      posts.filter((m) => m.type === "embed-page").map((m) => `${m.link} ${m.page}`),
    )
    assert.equal(asked.length, new Set(asked).size)

    // Past 500 pages, a note sends the reader to the PDF for the rest.
    await doc.$eval(box(HUGE), (figure) => figure.scrollIntoView())
    const huge = await doc.waitForSelector(`${box(HUGE)}[data-kind="pdf"]`)
    assert.deepEqual(
      await huge.evaluate((figure) => [
        figure.querySelectorAll(".drop-embed-page").length,
        figure.querySelector(".drop-embed-note").textContent,
        figure.querySelector(".drop-embed-note a").getAttribute("href"),
      ]),
      [500, "The doc shows the first 500 of 640 pages. Open Archive for the rest.", `/d/${HUGE}`],
    )

    // An attached PDF past the cap says so and links its file.
    await doc.$eval(box(CV_PAST_CAP), (figure) => figure.scrollIntoView())
    const past = await doc.waitForSelector(`${box(CV_PAST_CAP)} .drop-embed-note a`)
    assert.deepEqual(await past.evaluate((a) => [a.parentElement.textContent, a.getAttribute("href"), a.target]), [
      "Only the first 10 attached PDFs show inside a doc; open it: Letter",
      CV_PAST_CAP,
      "_blank",
    ])
  } finally {
    await browser.close()
  }
}, 30_000)
