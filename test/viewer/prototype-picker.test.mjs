import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium, firefox } from "playwright"
import { test } from "vite-plus/test"
const { parseFrameMessage } = await import("../../shared/frame-messages.ts")
const { embedDocument, injectRuntime, withVariantBar } = await import("../../shared/plan-runtime.ts")

const PICKER = await readFile(new URL("../../skills/prototype/assets/picker.js", import.meta.url), "utf8")
const liveItems = (count) =>
  Array.from(
    { length: count },
    (_, index) =>
      `<section id="v-${index}" data-variant="Page ${index}" data-src="/live/${index}" data-width="280" data-height="240"></section>`,
  ).join("")
const variants = (fields) => parseFrameMessage({ __drop: true, type: "variants", canvas: false, zoom: 100, ...fields })
const one = (id) => ({ id, label: id, note: "" })

test("a prototype's variants reach the viewer only within limits, with the showing one among them", () => {
  assert.deepEqual(variants({ variants: [one("v-a"), one("v-b")], current: 1 }), {
    type: "variants",
    variants: [one("v-a"), one("v-b")],
    current: 1,
    canvas: false,
    zoom: 100,
  })
  assert.equal(variants({ variants: [one("v-a")], current: 1 }), null)
  assert.equal(variants({ variants: [], current: 0 }), null)
  assert.equal(variants({ variants: Array.from({ length: 101 }, (_, n) => one(`v-${n}`)), current: 0 }), null)
  assert.equal(variants({ variants: [{ ...one("v-a"), note: "x".repeat(501) }], current: 0 }), null)
})

const page = (script, body = "") => `<!doctype html><html><head><meta charset="utf-8"></head><body${body}>
<section id="v-one" data-variant="One" data-note="The first"><input id="v-one-input"></section>
<section id="v-two" data-variant="Two" data-note="The second">two</section>
<section id="v-three" data-variant="Three">three</section>
${script ? `<script>${script}</script>` : ""}
</body></html>`
// What an agent pasted on drop.quiver.dk to save space: no header, no footer, and it never reports to Drop's bar.
const TRIMMED = `(() => {
  const variants = [...document.querySelectorAll("body > [data-variant]")];
  const key = "drop-prototype:" + location.pathname;
  variants.forEach((el, i) => { el.hidden = i !== 0; });
  window.trimmed = true;
})();`
const injected = (html) => html.split("<script data-drop-picker>").length - 1

test("Drop runs its own picker in every prototype and drops any copy the author pasted", () => {
  for (const pasted of [
    "",
    PICKER,
    TRIMMED,
    "// Drop prototype picker. Paste into a <script> at the end of the prototype's <body>, unchanged.\n(() => {\n  window.oldPicker = true;\n})();",
  ]) {
    const html = injectRuntime(page(pasted), false, 0, true)
    assert.equal(injected(html), 1)
    assert.ok(html.includes(`<script data-drop-picker>${PICKER.trimEnd()}</script>`))
    assert.equal(html.split("Drop prototype picker.").length, 2, "only Drop's copy is left")
    assert.ok(!html.includes("window.trimmed") && !html.includes("window.oldPicker"))
    assert.ok(html.includes("self.__dropPicker = true;"))
  }
  // `$` patterns in the picker's text stay as written.
  assert.ok(injectRuntime(page(""), false, 0, true).includes("${i + 1}"))
  // Copies loaded from the prototype's asset path go too, including Drop's published skill URL.
  for (const script of [
    '<script src="https://example.com/prototype/assets/picker.js"></script>',
    "<script src='/.well-known/agent-skills/prototype/assets/picker.js?v=1#picker'></script>",
    "<script src=../prototype/assets/picker.js></script>",
    '<script src="prototype/assets/picker.js"></script>',
  ]) {
    const linked = page("").replace("</body>", () => `${script}</body>`)
    for (const output of [injectRuntime(linked, false, 0, true), embedDocument(linked, false)]) {
      assert.equal(injected(output), 1)
      assert.ok(!output.includes(script))
    }
  }
  // The page's own scripts and a code sample of the picker stay.
  const own = `document.addEventListener("variantchange", (event) => { window.seen = event.detail.id; });`
  const sample = "<pre><code>// Drop prototype picker.</code></pre>"
  const authored = injectRuntime(
    page(own).replace("<body>", () => `<body>${sample}`),
    false,
    0,
    true,
  )
  assert.ok(authored.includes(`<script>${own}</script>`))
  assert.ok(authored.includes(sample))
  // A page without items gets no picker; a Markdown doc's `::drop` box gets one like the viewer.
  assert.equal(injected(injectRuntime("<html><head></head><body><p>Hi</p></body></html>", false, 0, true)), 0)
  assert.equal(injected(embedDocument(page(TRIMMED), false)), 1)
})

test("Drop preserves authored picker dependencies and variantchange scripts", () => {
  const scripts = [
    '<script src="/date-picker.js"></script>',
    "<script src='/color-picker.js?version=1'></script>",
    '<script src="https://cdn.example.com/calendar/picker.js"></script>',
    '<script src="/app.js?module=/prototype/assets/picker.js"></script>',
    '<script src="/prototype/assets/picker.js.map"></script>',
    '<script>document.dispatchEvent(new CustomEvent("variantchange", { detail: { id: "v-one" } }));</script>',
    '<script>document.addEventListener("variantchange", (event) => { window.seen = event.detail.id; });</script>',
    '<script>window.pickerHost = document.querySelector("prototype-picker"); window.hosted = self.__dropVariantBar;</script>',
    '<script>const source = "// Drop prototype picker."; const key = "drop-prototype:" + location.pathname;</script>',
  ]
  const html = page("").replace("</body>", () => `${scripts.join("\n")}</body>`)
  for (const output of [injectRuntime(html, false, 0, true), embedDocument(html, false)]) {
    assert.equal(injected(output), 1)
    for (const script of scripts) assert.ok(output.includes(script), `preserves ${script}`)
  }
})

/** The items showing, the mode, the picker's own bar, and the hash, read from a page or a frame. */
const look = (target) =>
  target.evaluate(() => ({
    shown: [...document.querySelectorAll("body > [data-variant]")].filter((el) => !el.hidden).map((el) => el.id),
    canvas: document.documentElement.dataset.prototypeLayout === "canvas",
    bar: Boolean(document.querySelector("prototype-picker")?.shadowRoot?.querySelector(".bar")),
    hash: location.hash,
  }))
const ALL = ["v-one", "v-two", "v-three"]

test("canvas labels align with their items and hide notes below 160 screen pixels", async () => {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
    for (const [width, zoom] of [
      [320, 0.5],
      [320, 159 / 320],
      [120, 0.41],
      [120, 0.05],
    ]) {
      const html = injectRuntime(
        page("")
          .replaceAll("<section ", `<section data-width="${width}" data-height="180" `)
          .replaceAll('data-variant="', 'data-variant="A long name for this prototype item: ')
          .replaceAll('data-note="', `data-note="${"A long note that should wrap within its item. ".repeat(8)}`),
        false,
        0,
        true,
      )
      const standalone = await context.newPage()
      await standalone.route("https://picker.test/labels", (route) =>
        route.fulfill({ contentType: "text/html", body: html }),
      )
      await standalone.addInitScript(
        ({ width, zoom }) => {
          localStorage.setItem(
            "drop-prototype-canvas:/labels",
            JSON.stringify({
              v: 1,
              camera: { x: 48, y: 160, z: zoom },
              positions: Object.fromEntries(["v-one", "v-two", "v-three"].map((id, i) => [id, [i * (width + 160), 0]])),
            }),
          )
        },
        { width, zoom },
      )
      await standalone.goto("https://picker.test/labels")
      await standalone.waitForFunction(() =>
        [...document.querySelector("prototype-picker").shadowRoot.querySelectorAll(".tag")].every(
          (tag) => tag.style.width,
        ),
      )
      const bounds = await standalone.evaluate(() => {
        const tags = [...document.querySelector("prototype-picker").shadowRoot.querySelectorAll(".tag")]
        return tags.map((tag, i) => {
          const item = document.querySelectorAll("body > [data-variant]")[i].getBoundingClientRect()
          const name = tag.querySelector(".name"),
            note = tag.querySelector(".tnote")
          const textLeft = (el) => {
            const range = document.createRange()
            range.selectNodeContents(el)
            return range.getBoundingClientRect().left
          }
          return {
            right: tag.getBoundingClientRect().right,
            itemLeft: item.left,
            itemRight: item.right,
            nameLeft: textLeft(name),
            nameTop: name.getBoundingClientRect().top,
            openTop: tag.querySelector(".open").getBoundingClientRect().top,
            noteLeft: textLeft(note),
            noteVisible: getComputedStyle(note).display !== "none",
            noteHeight: note.getBoundingClientRect().height,
            lineHeight: parseFloat(getComputedStyle(note).lineHeight),
          }
        })
      })
      for (const [i, label] of bounds.entries()) {
        assert.ok(Math.abs(label.right - label.itemRight) < 1, "label ends at the item's right edge")
        assert.ok(Math.abs(label.nameLeft - label.itemLeft) < 1, "name starts at the item's left edge")
        assert.equal(label.openTop, label.nameTop, "name and open button stay on one row, even at minimum zoom")
        assert.equal(label.noteVisible, i < 2 && width * zoom >= 160, "only wide items with notes show them")
        if (label.noteVisible) {
          assert.ok(Math.abs(label.noteLeft - label.itemLeft) < 1, "note starts at the item's left edge")
          assert.ok(Math.abs(label.noteHeight - (2 * label.lineHeight + 2)) < 1, "long notes wrap to two lines")
        }
      }
      await standalone.close()
    }
  } finally {
    await browser.close()
  }
})

test("zoomed out, a canvas label shows only what fits above its item and never covers another", async () => {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
    const sections = [0, 1, 2]
      .flatMap((row) => [0, 1].map((col) => [row, col]))
      .map(
        ([row, col]) =>
          `<section id="v-r${row}c${col}" data-variant="Item ${row}${col}" data-note="${"A note long enough to wrap. ".repeat(6)}" data-width="1200" data-height="1200" data-x="${col * 1360}" data-y="${row * 1400}"></section>`,
      )
      .join("")
    const html = injectRuntime(`<!doctype html><html><body>${sections}</body></html>`, false, 0, true)
    // [zoom, rows below the first that show their name, and their note]
    for (const [zoom, names, notes] of [
      [0.5, true, true],
      [0.2, true, false],
      [0.08, false, false],
    ]) {
      const tab = await context.newPage()
      await tab.route("https://picker.test/stack", (route) => route.fulfill({ contentType: "text/html", body: html }))
      await tab.addInitScript((z) => {
        localStorage.setItem("drop-prototype-canvas:/stack", JSON.stringify({ v: 1, camera: { x: 48, y: 120, z } }))
      }, zoom)
      await tab.goto("https://picker.test/stack")
      await tab.waitForFunction(() =>
        [...document.querySelector("prototype-picker").shadowRoot.querySelectorAll(".tag")].every(
          (tag) => tag.style.width,
        ),
      )
      const labels = await tab.evaluate(() => {
        const items = [...document.querySelectorAll("body > [data-variant]")].map((el) => el.getBoundingClientRect())
        const tags = [...document.querySelector("prototype-picker").shadowRoot.querySelectorAll(".tag")]
        return tags.map((tag, i) => {
          const shown = (el) => getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden"
          const parts = [".handle", ".name", ".tnote"].map((s) => tag.querySelector(s)).filter(shown)
          const covered = parts.some((el) => {
            const r = el.getBoundingClientRect()
            return items.some(
              (o, j) => j !== i && o.left < r.right && o.right > r.left && o.top < r.bottom && o.bottom > r.top,
            )
          })
          return { name: shown(tag.querySelector(".name")), note: shown(tag.querySelector(".tnote")), covered }
        })
      })
      for (const [i, label] of labels.entries()) {
        const top = i < 2
        assert.equal(label.covered, false, `label ${i} at ${zoom} covers no other item`)
        assert.equal(label.name, top || names, `label ${i} at ${zoom} shows its name only when it fits`)
        assert.equal(
          label.note,
          label.name && (top ? zoom * 1200 >= 160 : notes),
          `label ${i} at ${zoom} shows its note only when it fits`,
        )
      }
      await tab.close()
    }
  } finally {
    await browser.close()
  }
})

async function withLabelCanvas(sections, zoom, check) {
  const browser = await chromium.launch()
  try {
    const tab = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    const html = injectRuntime(`<!doctype html><html><body>${sections}</body></html>`, false, 0, true)
    await tab.route("https://picker.test/labels", (route) => route.fulfill({ contentType: "text/html", body: html }))
    await tab.addInitScript((z) => {
      localStorage.setItem("drop-prototype-canvas:/labels", JSON.stringify({ v: 1, camera: { x: 48, y: 120, z } }))
    }, zoom)
    await tab.goto("https://picker.test/labels")
    await tab.waitForFunction(
      () => document.querySelector("prototype-picker").shadowRoot.querySelector(".tag")?.style.width,
    )
    await check(tab, tab.locator("prototype-picker .tag").nth(1))
  } finally {
    await browser.close()
  }
}

test("a short canvas note stays visible when its single line fits", async () => {
  await withLabelCanvas(
    `<section id="v-upper" data-variant="Upper" data-width="1200" data-height="1200" data-x="0" data-y="0"></section>
    <section id="v-lower" data-variant="Lower" data-note="Short note" data-width="1200" data-height="1200" data-x="0" data-y="1400"></section>`,
    0.28,
    async (_tab, tag) => assert.equal(await tag.locator(".tnote").isVisible(), true),
  )
})

test("a short canvas note puts its handle collision check on the rendered row", async () => {
  await withLabelCanvas(
    `<section id="v-left" data-variant="Left" data-width="196" data-height="80" data-x="0" data-y="162"></section>
    <section id="v-right" data-variant="Right" data-note="Short note" data-width="240" data-height="100" data-x="200" data-y="200"></section>`,
    1,
    async (_tab, tag) => {
      assert.equal(await tag.locator(".tnote").isVisible(), true)
      assert.equal(await tag.locator(".handle").isVisible(), false)
    },
  )
})

test("a hidden canvas handle lets clicks reach a live item underneath", async () => {
  await withLabelCanvas(
    `<section id="v-left" data-variant="Left" data-width="196" data-height="80" data-x="0" data-y="170">
      <button style="width:100%;height:100%" onclick="this.textContent='Clicked'">Live button</button>
    </section>
    <section id="v-right" data-variant="Right" data-width="240" data-height="100" data-x="200" data-y="200"></section>`,
    1,
    async (tab, tag) => {
      assert.equal(await tag.locator(".handle").isVisible(), false)
      const bounds = await tag.boundingBox()
      await tab.mouse.click(bounds.x + 10, bounds.y + 10)
      assert.equal(await tab.locator("#v-left button").textContent(), "Clicked")
      await tag.locator(".open").click()
      assert.deepEqual((await look(tab)).shown, ["v-right"])
    },
  )
})

const focusSections = `<section id="v-upper" data-variant="Upper" data-width="240" data-height="80" data-x="0" data-y="0"></section>
    <section id="v-lower" data-variant="Lower" data-width="240" data-height="100" data-x="0" data-y="116"></section>`

test("an overlapping canvas label hides as soon as keyboard focus leaves it", async () => {
  await withLabelCanvas(focusSections, 1, async (tab, tag) => {
    const handle = tag.locator(".handle")
    const name = tag.locator(".name")
    await handle.focus()
    await tab.keyboard.press("ArrowUp")
    await tab.keyboard.press("ArrowUp")
    await tab.waitForFunction(
      () => JSON.parse(localStorage.getItem("drop-prototype-canvas:/labels")).positions?.["v-lower"]?.[1] === 100,
    )
    assert.equal(await name.isVisible(), true)
    await tab.keyboard.press("Tab")
    await tab.keyboard.press("Tab")
    assert.equal(await name.isVisible(), true)
    await tab.keyboard.press("Tab")
    await tab.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await name.isVisible(), false)
  })
})

test("an overlapping canvas label hides when focus moves from the Firefox iframe to the viewer", async () => {
  const browser = await firefox.launch()
  try {
    const tab = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    tab.setDefaultTimeout(5000)
    const html = injectRuntime(`<!doctype html><html><body>${focusSections}</body></html>`, false, 0, true)
    await tab.route("https://viewer.test/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<button>Viewer control</button><br><iframe src="https://picker.test/labels" width="900" height="600"></iframe>',
      }),
    )
    await tab.route("https://picker.test/labels", (route) => route.fulfill({ contentType: "text/html", body: html }))
    await tab.addInitScript(() => {
      if (location.origin !== "https://picker.test") return
      localStorage.setItem("drop-prototype-canvas:/labels", JSON.stringify({ v: 1, camera: { x: 48, y: 120, z: 1 } }))
    })
    await tab.goto("https://viewer.test/")
    const frame = tab.frame({ url: "https://picker.test/labels" })
    const prototype = tab.frameLocator("iframe")
    const handle = prototype.getByRole("button", { name: "Move Lower" })
    const name = prototype.locator("prototype-picker .tag .name").nth(1)
    await handle.click()
    await tab.keyboard.press("ArrowUp")
    await tab.keyboard.press("ArrowUp")
    await frame.waitForFunction(
      () => JSON.parse(localStorage.getItem("drop-prototype-canvas:/labels")).positions?.["v-lower"]?.[1] === 100,
    )
    assert.equal(await frame.evaluate(() => document.hasFocus()), true)
    assert.equal(await name.isVisible(), true)
    await tab.getByRole("button", { name: "Viewer control" }).click()
    await frame.waitForFunction(() => !document.hasFocus())
    await name.waitFor({ state: "hidden", timeout: 3000 })
  } finally {
    await browser.close()
  }
}, 20000)

test("a prototype opens on the canvas; an item opens in focus and comes back as it was", async () => {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
    const alone = injectRuntime(page(""), false, 0, true)
    await context.route("https://picker.test/alone", (route) =>
      route.fulfill({ contentType: "text/html", body: alone }),
    )
    await context.route("https://picker.test/single", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: injectRuntime(page("", ' data-layout="single"'), false, 0, true),
      }),
    )
    const standalone = await context.newPage()
    await standalone.goto("https://picker.test/alone")
    assert.deepEqual(await look(standalone), { shown: ALL, canvas: true, bar: true, hash: "" })
    await standalone.keyboard.press("2")
    assert.deepEqual(await look(standalone), { shown: ["v-two"], canvas: false, bar: true, hash: "#v-two" })
    await standalone.keyboard.press("ArrowRight")
    assert.deepEqual((await look(standalone)).shown, ["v-three"])
    await standalone.keyboard.press("ArrowRight")
    assert.deepEqual((await look(standalone)).shown, ["v-one"])
    // Typed text survives the trip back to the canvas: the same element, never remounted.
    await standalone.fill("#v-one-input", "kept")
    await standalone.locator("#v-one").click({ position: { x: 600, y: 4 } })
    await standalone.keyboard.press("Escape")
    assert.deepEqual(await look(standalone), { shown: ALL, canvas: true, bar: true, hash: "" })
    assert.equal(await standalone.inputValue("#v-one-input"), "kept")
    // Double-clicking a name opens its item; a hash opens one in focus; `data-layout="single"` opts out of the canvas.
    await standalone.evaluate(() =>
      document
        .querySelector("prototype-picker")
        .shadowRoot.querySelectorAll(".tag .name")[2]
        .dispatchEvent(new MouseEvent("dblclick")),
    )
    assert.deepEqual((await look(standalone)).shown, ["v-three"])
    await standalone.goto("https://picker.test/alone#v-two")
    assert.deepEqual((await look(standalone)).shown, ["v-two"])
    await standalone.goto("https://picker.test/single")
    assert.equal((await look(standalone)).canvas, false)
  } finally {
    await browser.close()
  }
})

test("the canvas keeps its camera for the version it was moved on, and a new version opens fitted", async () => {
  const browser = await chromium.launch()
  try {
    const tab = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    const html = injectRuntime(
      page("").replaceAll("<section ", '<section data-width="800" data-height="500" '),
      false,
      0,
      true,
    )
    let version = "d1@1"
    await tab.route("https://picker.test/versions", (route) =>
      route.fulfill({ contentType: "text/html", body: withVariantBar(html, version) }),
    )
    const scale = () =>
      tab.evaluate(() => document.getElementById("v-one").style.transform.match(/scale\(([\d.]+)\)/)?.[1])
    const open = async () => {
      await tab.goto("https://picker.test/versions")
      await tab.waitForFunction(() => /scale\(/.test(document.getElementById("v-one").style.transform))
      await tab.waitForTimeout(300)
    }
    await open()
    assert.notEqual(await scale(), "1", "the first visit fits all three items")
    await tab.keyboard.press("0")
    await tab.waitForFunction(() => document.getElementById("v-one").style.transform.endsWith("scale(1)"))
    await tab.waitForTimeout(300)
    await open()
    assert.equal(await scale(), "1", "the same version comes back where it was left")
    version = "d1@2"
    await open()
    assert.notEqual(await scale(), "1", "a new version opens fitted")
  } finally {
    await browser.close()
  }
})

test("the address keeps where the canvas looks, so a link opens there on another screen, and Fit clears it", async () => {
  const browser = await chromium.launch()
  try {
    const html = injectRuntime(
      page("").replaceAll("<section ", '<section data-width="800" data-height="500" '),
      false,
      0,
      true,
    )
    const open = async (viewport, hash = "") => {
      // A fresh context each time: no camera remembered, so only the address can place it.
      const context = await browser.newContext({ viewport })
      await context.route("https://picker.test/view", (route) =>
        route.fulfill({ contentType: "text/html", body: html }),
      )
      const tab = await context.newPage()
      await tab.goto(`https://picker.test/view${hash}`)
      await tab.waitForFunction(() => /scale\(/.test(document.getElementById("v-one").style.transform))
      return tab
    }
    const scale = (tab) =>
      tab.evaluate(() => Number(document.getElementById("v-two").style.transform.match(/scale\(([\d.]+)\)/)[1]))
    const middleOf = (tab, id) =>
      tab.evaluate((id) => {
        const r = document.getElementById(id).getBoundingClientRect()
        return { x: innerWidth / 2 - r.left, y: (56 + innerHeight - 72) / 2 - r.top }
      }, id)

    const tab = await open({ width: 1000, height: 700 })
    await tab.waitForTimeout(400)
    assert.equal(new URL(tab.url()).hash, "", "fitted to everything, the address names no view")
    await tab.keyboard.press("2")
    await tab.keyboard.press("Escape")
    await tab.waitForFunction(() => location.hash.startsWith("#@v-two,"))
    await tab.keyboard.press("0")
    for (let n = 0; n < 3; n++) await tab.keyboard.press("+")
    await tab.mouse.move(500, 350)
    await tab.mouse.wheel(120, 60)
    await tab.waitForFunction(() => /^#@v-\w+,-?\d+,-?\d+,195.3z$/.test(location.hash))
    const hash = await tab.evaluate(() => location.hash)
    const [, id, x, y] = hash.match(/^#@([\w-]+),(-?\d+),(-?\d+),/)
    // Opened again without it, the camera this reader left comes back and puts its view in the address.
    await tab.waitForTimeout(300)
    await tab.goto("https://picker.test/view")
    await tab.waitForFunction((hash) => location.hash === hash, hash)

    // A link opens on the same spot at the same zoom, on a bigger screen too, and keeps the same address.
    for (const viewport of [
      { width: 1000, height: 700 },
      { width: 1400, height: 900 },
    ]) {
      const other = await open(viewport, hash)
      await other.waitForFunction(
        (zoom) => document.getElementById("v-two").style.transform.endsWith(`scale(${zoom})`),
        1.953,
      )
      const middle = await middleOf(other, id)
      assert.ok(Math.abs(middle.x / (await scale(other)) - Number(x)) < 1.5, `x on ${viewport.width}px`)
      assert.ok(Math.abs(middle.y / (await scale(other)) - Number(y)) < 1.5, `y on ${viewport.width}px`)
      await other.waitForTimeout(400)
      assert.equal(await other.evaluate(() => location.hash), hash)
      // Fit all clears it: a link then fits the reader's own screen.
      await other.keyboard.press("Shift+Digit1")
      await other.waitForFunction(() => location.hash === "")
      await other.context().close()
    }
    // A view naming no item here opens fitted, and an item's id still opens it in focus.
    const gone = await open({ width: 1000, height: 700 }, "#@v-gone,10,10,300z")
    await gone.waitForTimeout(400)
    assert.notEqual(await scale(gone), 3)
    assert.equal((await look(gone)).canvas, true)
    await gone.evaluate(() => (location.hash = "#@v-three,400,250,50z"))
    await gone.waitForFunction(() => document.getElementById("v-three").style.transform.endsWith("scale(0.5)"))
    await gone.evaluate(() => (location.hash = "#v-three"))
    await gone.waitForFunction(() => document.documentElement.dataset.prototypeLayout !== "canvas")
    assert.deepEqual((await look(gone)).shown, ["v-three"])
  } finally {
    await browser.close()
  }
}, 20000)

test("the canvas camera stops before the last item leaves the screen, and the minimap moves it", async () => {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
    const html = injectRuntime(
      page("").replaceAll("<section ", '<section data-width="800" data-height="500" '),
      false,
      0,
      true,
    )
    const tab = await context.newPage()
    await tab.route("https://picker.test/fence", (route) => route.fulfill({ contentType: "text/html", body: html }))
    // Three items in a row and one far below: the empty corners of their bounding box are no place to stop.
    await tab.addInitScript(() =>
      localStorage.setItem(
        "drop-prototype-canvas:/fence",
        JSON.stringify({
          v: 1,
          camera: null,
          positions: { "v-one": [0, 0], "v-two": [960, 0], "v-three": [1200, 2400] },
        }),
      ),
    )
    await tab.goto("https://picker.test/fence")
    await tab.waitForFunction(() => document.documentElement.dataset.prototypeLayout === "canvas")
    // Some item shows 160px of itself each way on screen, or all of itself where it's smaller.
    const shown = () =>
      tab.evaluate(() =>
        [...document.querySelectorAll("body > [data-variant]")].some((el) => {
          const r = el.getBoundingClientRect()
          const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0)
          const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)
          return w >= Math.min(160, r.width) - 1 && h >= Math.min(160, r.height) - 1
        }),
      )
    for (const [dx, dy] of [
      [9000, 9000],
      [-9000, -9000],
      [-9000, 9000],
      [9000, -9000],
    ]) {
      await tab.mouse.move(500, 350)
      await tab.mouse.down({ button: "middle" })
      for (let step = 1; step <= 20; step++) await tab.mouse.move(500 + (dx * step) / 20, 350 + (dy * step) / 20)
      await tab.mouse.up({ button: "middle" })
      assert.ok(await shown(), `an item stays on screen after dragging ${dx}, ${dy}`)
    }
    // Wheel panning stops at the fence too.
    await tab.mouse.move(500, 350)
    for (let n = 0; n < 40; n++) await tab.mouse.wheel(0, 2000)
    assert.ok(await shown(), "an item stays on screen after wheeling away")

    // The minimap: a click centres the camera there, at the same zoom.
    await tab.keyboard.press("0")
    await tab.waitForFunction(() => document.getElementById("v-one").style.transform.endsWith("scale(1)"))
    const transform = () => tab.evaluate(() => document.getElementById("v-one").style.transform)
    const before = await transform()
    const map = await tab.evaluate(() => {
      const r = document.querySelector("prototype-picker").shadowRoot.querySelector(".map").getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    })
    assert.ok(map.w > 0 && map.x + map.w <= 1000 && map.y + map.h <= 700, "the minimap sits in the bottom-right corner")
    await tab.mouse.click(map.x + map.w / 2, map.y + map.h * 0.9)
    await tab.waitForFunction((before) => document.getElementById("v-one").style.transform !== before, before)
    assert.ok((await transform()).endsWith("scale(1)"))
    assert.ok(await shown(), "the jump lands inside the fence")
    // Focus has no minimap.
    await tab.keyboard.press("1")
    assert.equal(
      await tab.evaluate(
        () => document.querySelector("prototype-picker").shadowRoot.querySelector(".map").getBoundingClientRect().width,
      ),
      0,
    )
  } finally {
    await browser.close()
  }
})

test("adding an authored position replaces cached defaults but keeps explicit reader moves", async () => {
  const browser = await chromium.launch()
  try {
    const tab = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    let html = page("").replaceAll("<section ", '<section data-width="800" data-height="500" ')
    await tab.route("https://picker.test/revisit", (route) =>
      route.fulfill({ contentType: "text/html", body: injectRuntime(html, false, 0, true) }),
    )
    const positions = () =>
      tab.evaluate(() => JSON.parse(localStorage.getItem("drop-prototype-canvas:/revisit")).positions)
    await tab.goto("https://picker.test/revisit")
    assert.deepEqual(await positions(), { "v-one": [0, 0], "v-two": [960, 0], "v-three": [1920, 0] })

    await tab.locator('prototype-picker .handle[aria-label="Move Three"]').focus()
    await tab.keyboard.press("Shift+ArrowDown")
    await tab.waitForFunction(
      () => JSON.parse(localStorage.getItem("drop-prototype-canvas:/revisit")).moved.length === 1,
    )
    const moved = { "v-one": [0, 0], "v-two": [960, 0], "v-three": [1920, 64] }
    assert.deepEqual(await positions(), moved)
    await tab.reload()
    assert.deepEqual(await positions(), moved)

    await tab.locator('prototype-picker .handle[aria-label="Move Three"]').focus()
    for (let step = 0; step < 7; step++) await tab.keyboard.press("Shift+ArrowDown")
    await tab.waitForFunction(
      () => JSON.parse(localStorage.getItem("drop-prototype-canvas:/revisit")).positions["v-three"][1] === 512,
    )
    html = html.replace('id="v-one"', 'id="v-one" data-x="960" data-y="0"')
    await tab.reload()
    assert.deepEqual(await positions(), { "v-one": [960, 0], "v-two": [1920, 0], "v-three": [1920, 512] })
  } finally {
    await browser.close()
  }
})

test("the minimap stays clear of the standalone controls when the toolbar wraps", async () => {
  const browser = await chromium.launch()
  try {
    const tab = await browser.newPage({ viewport: { width: 1000, height: 750 } })
    const html = injectRuntime(page(""), false, 0, true)
    await tab.route("https://picker.test/wrapped", (route) => route.fulfill({ contentType: "text/html", body: html }))
    await tab.goto("https://picker.test/wrapped")
    await tab.locator('prototype-picker .handle[aria-label="Move One"]').focus()
    await tab.keyboard.press("Shift+ArrowDown")
    await tab.waitForFunction(
      () => JSON.parse(localStorage.getItem("drop-prototype-canvas:/wrapped")).moved.length === 1,
    )
    await tab.setViewportSize({ width: 393, height: 750 })
    await tab.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

    const bar = tab.locator("prototype-picker .bar")
    const map = tab.locator("prototype-picker .map canvas")
    const barBox = await bar.boundingBox()
    const mapBox = await map.boundingBox()
    assert.ok(mapBox.y + mapBox.height < barBox.y, "the full minimap is above the wrapped toolbar")
    await map.click()
    assert.deepEqual(
      await tab.evaluate(() => JSON.parse(localStorage.getItem("drop-prototype-canvas:/wrapped")).moved),
      ["v-one"],
    )
    await bar.getByRole("button", { name: "Hand", exact: true }).click()
    await bar.getByRole("button", { name: "Move", exact: true }).click()
    await bar.getByRole("button", { name: "Reset layout", exact: true }).click()
    await tab.waitForFunction(
      () => JSON.parse(localStorage.getItem("drop-prototype-canvas:/wrapped")).moved.length === 0,
    )
  } finally {
    await browser.close()
  }
})

test("fitted controls stay clickable above the raised minimap on a phone", async () => {
  const browser = await chromium.launch()
  try {
    const tab = await browser.newPage({ viewport: { width: 393, height: 750 } })
    const html = injectRuntime(
      `<!doctype html><html><body>
        <section id="v-one" data-variant="One" data-width="160" data-height="620" data-x="0" data-y="0">one</section>
        <section id="v-two" data-variant="Two" data-width="120" data-height="80" data-x="209" data-y="526">
          <button style="margin: 20px">Continue</button>
        </section>
      </body></html>`,
      false,
      0,
      true,
    )
    await tab.route("https://picker.test/fitted", (route) => route.fulfill({ contentType: "text/html", body: html }))
    await tab.goto("https://picker.test/fitted")
    const bar = tab.locator("prototype-picker .bar")
    const map = tab.locator("prototype-picker .map")
    const button = tab.getByRole("button", { name: "Continue", exact: true })
    for (const action of ["Fit", "Reset layout"]) {
      await bar.getByRole("button", { name: action, exact: true }).click()
      await tab.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const itemBox = await tab.locator("#v-two").boundingBox()
      const mapBox = await map.boundingBox()
      assert.ok(itemBox.y + itemBox.height < mapBox.y, `the fitted item clears the minimap after ${action}`)
      await button.click({ trial: true })
    }
  } finally {
    await browser.close()
  }
})

test("items open where data-x and data-y place them, a reader's move wins for that reader, and Reset layout goes back", async () => {
  const browser = await chromium.launch()
  try {
    const html = injectRuntime(
      page("")
        .replaceAll("<section ", '<section data-width="800" data-height="500" ')
        .replace('id="v-one"', 'id="v-one" data-x="0" data-y="0"')
        .replace('id="v-two"', 'id="v-two" data-x="0" data-y="900"'),
      false,
      0,
      true,
    )
    const tab = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    await tab.route("https://picker.test/authored", (route) => route.fulfill({ contentType: "text/html", body: html }))
    // A position saved before data-x existed, as every visit saves them all, doesn't hide the authored layout.
    await tab.addInitScript(() => {
      if (sessionStorage.getItem("seeded")) return
      sessionStorage.setItem("seeded", "1")
      localStorage.setItem(
        "drop-prototype-canvas:/authored",
        JSON.stringify({ v: 1, camera: null, positions: { "v-one": [0, 0], "v-two": [960, 0], "v-three": [1920, 0] } }),
      )
    })
    // Each item's place on the plane, from its transform: screen = camera + plane × zoom.
    const places = () =>
      tab.evaluate(() => {
        const at = (id) =>
          document
            .getElementById(id)
            .style.transform.match(/[-\d.]+/g)
            .map(Number)
        const [x0, y0, z] = at("v-one")
        return Object.fromEntries(
          ["v-one", "v-two", "v-three"].map((id) => {
            const [x, y] = at(id)
            return [id, [Math.round((x - x0) / z), Math.round((y - y0) / z)]]
          }),
        )
      })
    const open = async () => {
      await tab.goto("https://picker.test/authored")
      await tab.waitForFunction(() => /scale\(/.test(document.getElementById("v-one").style.transform))
    }
    await open()
    // Three has no data-x and was never moved, so it follows the placed items.
    assert.deepEqual(await places(), { "v-one": [0, 0], "v-two": [0, 900], "v-three": [960, 0] })

    // The reader moves Two with its handle's arrow keys; both Two and the untouched Three keep their positions.
    await tab.locator('prototype-picker .handle[aria-label="Move Two"]').focus()
    await tab.keyboard.press("Shift+ArrowRight")
    await tab.waitForTimeout(300)
    await open()
    assert.deepEqual(await places(), { "v-one": [0, 0], "v-two": [64, 900], "v-three": [960, 0] })

    // Reset layout forgets every move.
    await tab.locator("prototype-picker .layout").click()
    await tab.waitForTimeout(300)
    assert.deepEqual(await places(), { "v-one": [0, 0], "v-two": [0, 900], "v-three": [960, 0] })
    await open()
    assert.deepEqual(await places(), { "v-one": [0, 0], "v-two": [0, 900], "v-three": [960, 0] })
  } finally {
    await browser.close()
  }
})

test("Ctrl+Z takes back a move or Reset layout, Ctrl+Shift+Z and Ctrl+Y redo it, saved as a drag is; a field keeps its undo", async () => {
  const browser = await chromium.launch()
  try {
    const tab = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    const html = injectRuntime(
      page("").replaceAll("<section ", '<section data-width="800" data-height="500" '),
      false,
      0,
      true,
    )
    await tab.route("https://picker.test/undo", (route) => route.fulfill({ contentType: "text/html", body: html }))
    const stored = () => tab.evaluate(() => JSON.parse(localStorage.getItem("drop-prototype-canvas:/undo")))
    // Waits until the saved layout has Three at y and Two at x, and returns which items count as moved.
    const saved = async (three, two = 960) => {
      await tab.waitForFunction(
        ([three, two]) => {
          const doc = JSON.parse(localStorage.getItem("drop-prototype-canvas:/undo"))
          return doc.positions["v-three"][1] === three && doc.positions["v-two"][0] === two
        },
        [three, two],
      )
      return (await stored()).moved.sort()
    }
    await tab.goto("https://picker.test/undo")
    assert.deepEqual(await saved(0), [])

    await tab.locator('prototype-picker .handle[aria-label="Move Three"]').focus()
    await tab.keyboard.press("Shift+ArrowDown")
    assert.deepEqual(await saved(64), ["v-three"])
    await tab.keyboard.press("Control+z")
    assert.deepEqual(await saved(0), [])
    await tab.keyboard.press("Control+Shift+z")
    assert.deepEqual(await saved(64), ["v-three"])

    // A drag by the handle is one step.
    const handle = await tab.locator('prototype-picker .handle[aria-label="Move Two"]').boundingBox()
    const zoom = await tab.evaluate(() =>
      Number(document.getElementById("v-one").style.transform.match(/scale\(([\d.]+)\)/)[1]),
    )
    await tab.mouse.move(handle.x + 10, handle.y + 10)
    await tab.mouse.down()
    await tab.mouse.move(handle.x + 10 + 50 * zoom, handle.y + 10, { steps: 4 })
    await tab.keyboard.press("Control+z")
    await tab.mouse.up()
    assert.deepEqual(await saved(64, 1010), ["v-three", "v-two"])
    await tab.keyboard.press("Control+z")
    assert.deepEqual(await saved(64), ["v-three"])

    // Reset layout is a step too, and Ctrl+Y does it again.
    await tab.locator("prototype-picker .layout").click()
    assert.deepEqual(await saved(0), [])
    await tab.keyboard.press("Control+z")
    assert.deepEqual(await saved(64), ["v-three"])
    await tab.keyboard.press("Control+y")
    assert.deepEqual(await saved(0), [])
    await tab.keyboard.press("Control+z")
    assert.deepEqual(await saved(64), ["v-three"])

    // In a field, Ctrl+Z is the field's: the move stays.
    await tab.locator("#v-one-input").fill("typed")
    await tab.locator("#v-one-input").press("Control+z")
    await tab.waitForTimeout(300)
    assert.deepEqual((await stored()).positions["v-three"], [1920, 64])
  } finally {
    await browser.close()
  }
})

test("items the page doesn't place wrap into rows with room between them, beside the authored ones", async () => {
  const browser = await chromium.launch()
  try {
    const tab = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    // Twelve items whose height comes from their content, and one placed by the author.
    const sections = Array.from(
      { length: 12 },
      (_, n) =>
        `<section id="v-${n}" data-variant="Page ${n}"><div style="height:${n === 5 ? 700 : 600}px"></div></section>`,
    ).join("")
    const html = injectRuntime(
      `<!doctype html><html><body><section id="v-placed" data-variant="Placed" data-x="0" data-y="0" data-height="400"></section>${sections}</body></html>`,
      false,
      0,
      true,
    )
    await tab.route("https://picker.test/rows", (route) => route.fulfill({ contentType: "text/html", body: html }))
    await tab.goto("https://picker.test/rows")
    await tab.waitForFunction(() => {
      const doc = JSON.parse(localStorage.getItem("drop-prototype-canvas:/rows") || "null")
      return doc && doc.positions["v-11"][1] > 0
    })
    await tab.waitForTimeout(500)
    const { positions } = await tab.evaluate(() => JSON.parse(localStorage.getItem("drop-prototype-canvas:/rows")))
    assert.deepEqual(positions["v-placed"], [0, 0], "the authored item keeps its data-x and data-y")
    // Four 1280px items per row, 160px apart, right of the placed item; each row 240px below the tallest above it.
    const rows = [0, 840, 1780]
    for (let n = 0; n < 12; n++) assert.deepEqual(positions[`v-${n}`], [1440 * (1 + (n % 4)), rows[Math.floor(n / 4)]])
    // The first fit leaves 64px of room on each side.
    const edges = await tab.evaluate(() => {
      const rects = [...document.querySelectorAll("body > [data-variant]")].map((el) => el.getBoundingClientRect())
      return { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) }
    })
    assert.ok(Math.abs(edges.left - 64) < 1 && Math.abs(1000 - edges.right - 64) < 1, JSON.stringify(edges))

    await tab.locator("#v-0 > div").evaluate((el) => (el.style.height = "900px"))
    await tab.waitForFunction(() => {
      const doc = JSON.parse(localStorage.getItem("drop-prototype-canvas:/rows"))
      return doc.positions["v-4"][1] === 1140 && doc.positions["v-8"][1] === 2080
    })
  } finally {
    await browser.close()
  }
})

test("automatic rows reflow across versions and undo, but a saved one-row layout stays until reset", async () => {
  const browser = await chromium.launch()
  try {
    const tab = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    let height = 300
    const url = "https://picker.test/reflow"
    await tab.route(url, (route) => {
      const sections = Array.from(
        { length: 6 },
        (_, index) =>
          `<section id="v-${index}" data-variant="Page ${index}"><div style="height:${index === 0 ? height : 300}px"></div></section>`,
      ).join("")
      const html = `<!doctype html><html><body><script>self.__dropVersion = "${height}"</script>${sections}</body></html>`
      return route.fulfill({ contentType: "text/html", body: injectRuntime(html, false, 0, true) })
    })
    await tab.addInitScript(() => {
      if (sessionStorage.getItem("seeded")) return
      sessionStorage.setItem("seeded", "1")
      const positions = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`v-${index}`, [index * 1440, 0]]))
      localStorage.setItem("drop-prototype-canvas:/reflow", JSON.stringify({ v: 1, positions, moved: [] }))
    })
    const saved = (fifth, sixth) =>
      tab.waitForFunction(
        ([fifth, sixth]) => {
          const { positions } = JSON.parse(localStorage.getItem("drop-prototype-canvas:/reflow"))
          return String(positions["v-4"]) === String(fifth) && String(positions["v-5"]) === String(sixth)
        },
        [fifth, sixth],
        { timeout: 3000 },
      )
    await tab.goto(url)
    await saved([5760, 0], [7200, 0])
    await tab.locator("prototype-picker .layout").click()
    await saved([0, 540], [1440, 540])
    await tab.keyboard.press("Control+z")
    await saved([5760, 0], [7200, 0])
    await tab.keyboard.press("Control+y")
    await saved([0, 540], [1440, 540])

    height = 900
    await tab.reload()
    await saved([0, 1140], [1440, 1140])

    await tab.getByRole("button", { name: "Move Page 5" }).press("Shift+ArrowDown")
    await saved([0, 1140], [1440, 1204])
    await tab.locator("#v-0 > div").evaluate((el) => (el.style.height = "600px"))
    await saved([0, 840], [1440, 1204])
    await tab.keyboard.press("Control+z")
    await saved([0, 840], [1440, 840])
    await tab.keyboard.press("Control+y")
    await saved([0, 840], [1440, 1204])
  } finally {
    await browser.close()
  }
})

test("the Hand tool pans from over an item, which gets no clicks, and Space does the same while held", async () => {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
    const html = injectRuntime(
      page("").replace(
        "<input",
        '<button id="v-one-button" onclick="window.clicks = (window.clicks || 0) + 1">press</button><input',
      ),
      false,
      0,
      true,
    )
    const tab = await context.newPage()
    await tab.route("https://picker.test/hand", (route) => route.fulfill({ contentType: "text/html", body: html }))
    await tab.goto("https://picker.test/hand")
    await tab.waitForFunction(() => document.documentElement.dataset.prototypeLayout === "canvas")
    await tab.keyboard.press("0")
    const at = () => tab.evaluate(() => document.getElementById("v-one").getBoundingClientRect().x)
    const button = await tab.locator("#v-one-button").boundingBox()
    const centre = { x: button.x + button.width / 2, y: button.y + button.height / 2 }
    const cursor = () =>
      tab.evaluate(
        ([x, y]) => {
          const el = document.elementFromPoint(x, y)
          return getComputedStyle(el.shadowRoot ? el.shadowRoot.elementFromPoint(x, y) : el).cursor
        },
        [centre.x, centre.y],
      )
    const drag = async (dx) => {
      await tab.mouse.move(centre.x, centre.y)
      await tab.mouse.down()
      for (let step = 1; step <= 5; step++) await tab.mouse.move(centre.x + (dx * step) / 5, centre.y)
      await tab.mouse.up()
    }

    // Under Move, the item's button takes the click and a drag over it doesn't pan.
    await tab.mouse.click(centre.x, centre.y)
    assert.equal(await tab.evaluate(() => window.clicks), 1)
    let before = await at()
    await drag(-80)
    assert.equal(await at(), before)

    // H picks the Hand tool: grab cursor over the item, a drag pans, and the release clicks nothing.
    await tab.keyboard.press("h")
    assert.equal(await cursor(), "grab")
    assert.equal(
      await tab.evaluate(() =>
        document.querySelector("prototype-picker").shadowRoot.querySelector(".hand").getAttribute("aria-pressed"),
      ),
      "true",
    )
    before = await at()
    await drag(120)
    assert.equal(Math.round((await at()) - before), 120)
    await tab.mouse.click(centre.x + 120, centre.y)
    assert.equal(await tab.evaluate(() => window.clicks), 1, "the Hand tool gives the items no clicks")

    // V puts it down; holding Space picks it up again only while held. Space on a focused button still presses it.
    await tab.keyboard.press("v")
    await tab.evaluate(() => document.activeElement.blur())
    assert.notEqual(await cursor(), "grab")
    await tab.keyboard.down(" ")
    assert.equal(await cursor(), "grab")
    before = await at()
    await tab.mouse.move(centre.x + 120, centre.y)
    await tab.mouse.down()
    assert.equal(await tab.evaluate(() => document.documentElement.dataset.prototypeHand), "grabbing")
    await tab.mouse.move(centre.x + 60, centre.y, { steps: 4 })
    await tab.mouse.up()
    await tab.keyboard.up(" ")
    assert.equal(Math.round((await at()) - before), -60)
    assert.equal(await tab.evaluate(() => "prototypeHand" in document.documentElement.dataset), false)

    // Focus has no Hand: the item takes its clicks.
    await tab.keyboard.press("h")
    await tab.keyboard.press("1")
    await tab.locator("#v-one-button").click()
    assert.equal(await tab.evaluate(() => window.clicks), 2)
  } finally {
    await browser.close()
  }
})

test("initial fit and Zoom to fit keep tall phone variants above the raised dock", async () => {
  const browser = await chromium.launch()
  try {
    const tab = await browser.newPage({ viewport: { width: 393, height: 852 }, hasTouch: true })
    const prototype = `<!doctype html><html><head></head><body>
      <section id="v-one" data-variant="First phone screen with a long title" data-note="A long note for the first prototype screen that wraps below its title" data-width="360" data-height="1800">
        <button id="target" style="position:absolute;bottom:12px;left:40px" onclick="this.textContent = 'Tapped'">Tap</button>
      </section>
      <section id="v-two" data-variant="Second phone screen" data-width="360" data-height="1800"></section>
      </body></html>`
    const frame = withVariantBar(injectRuntime(prototype, false, 0, true))
    await tab.route("https://picker.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body:
          new URL(route.request().url()).pathname === "/phone"
            ? frame
            : `<!doctype html><iframe src="/phone" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>
             <div id="dock" style="position:fixed;inset:auto 2px 64px;height:50px;background:#222"></div>`,
      }),
    )
    await tab.goto("https://picker.test/viewer")
    const phone = tab.frame({ url: "https://picker.test/phone" })
    await phone.waitForFunction(() => document.querySelector("#v-one").getBoundingClientRect().height < 900)
    const dock = await tab.locator("#dock").boundingBox()
    const send = (message) =>
      tab.evaluate((message) => {
        document.querySelector("iframe").contentWindow.postMessage({ __drop: true, ...message }, location.origin)
      }, message)
    const assertFits = async () => {
      await phone.waitForFunction(
        (top) =>
          [...document.querySelectorAll("section[data-variant]")].every((item) => {
            const rect = item.getBoundingClientRect()
            return rect.top >= 56 && rect.bottom <= top
          }),
        dock.y,
        { timeout: 2500 },
      )
      const target = phone.locator("#target")
      await target.tap()
      await phone.getByRole("button", { name: "Tapped" }).waitFor()
      await target.evaluate((button) => {
        button.textContent = "Tap"
      })
    }
    await send({ type: "inset", right: 0, bottom: 852 - dock.y })
    await assertFits()
    await send({ type: "picker", do: "reset" })
    await phone.waitForFunction(() => document.querySelector("#v-one").getBoundingClientRect().height === 1800)
    await send({ type: "picker", do: "fit" })
    await assertFits()
  } finally {
    await browser.close()
  }
})

test("inside Drop's viewer the page reports to Drop's bar and takes its commands, even with a trimmed copy pasted", async () => {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
    const framed = withVariantBar(injectRuntime(page(TRIMMED), false, 0, true))
    // The viewer's side of the bridge: it syncs once the frame's runtime is ready and keeps what the picker reports.
    const viewer = `<!doctype html><html><body style="margin:0"><iframe id="f" style="width:900px;height:600px;border:0"></iframe><script>
      window.reports = [];
      const frame = document.getElementById("f");
      const send = (message) => frame.contentWindow.postMessage({ __drop: true, ...message }, "*");
      window.send = send;
      addEventListener("message", (event) => {
        if (event.source !== frame.contentWindow || !event.data || !event.data.__drop) return;
        if (event.data.type === "ready") send({ type: "picker", do: "sync" });
        if (event.data.type === "variants") reports.push(event.data);
      });
      frame.srcdoc = ${JSON.stringify(framed).replaceAll("</script", "<\\/script")};
    </script></body></html>`
    await context.route("https://picker.test/viewer", (route) =>
      route.fulfill({ contentType: "text/html", body: viewer }),
    )

    const hosted = await context.newPage()
    await hosted.goto("https://picker.test/viewer")
    const last = () => hosted.evaluate(() => reports.at(-1))
    await hosted.waitForFunction(() => reports.length > 0)
    const frame = hosted.frame({ url: "about:srcdoc" })
    assert.deepEqual(
      { ...(await look(frame)), hash: undefined },
      { shown: ALL, canvas: true, bar: false, hash: undefined },
    )
    const report = await last()
    assert.deepEqual(
      { ...report, zoom: undefined },
      {
        __drop: true,
        type: "variants",
        variants: [
          { id: "v-one", label: "One", note: "The first" },
          { id: "v-two", label: "Two", note: "The second" },
          { id: "v-three", label: "Three", note: "" },
        ],
        current: 0,
        canvas: true,
        zoom: undefined,
        tool: "move",
        view: "",
      },
    )
    assert.ok(parseFrameMessage(report), "Drop's viewer accepts what the picker posts")
    // Drop hands over the view in its address; the picker reports it back once it's there, and drops one it can't place.
    await hosted.evaluate(() => send({ type: "picker", do: "view", hash: "#@v-two,100,50,150z" }))
    await hosted.waitForFunction(() => reports.at(-1).view === "@v-two,100,50,150z" && reports.at(-1).zoom === 150)
    assert.ok(parseFrameMessage(await last()))
    const count = await hosted.evaluate(() => reports.length)
    await hosted.evaluate(() => send({ type: "picker", do: "view", hash: "#@v-gone,1,1,100z" }))
    await hosted.waitForFunction((count) => reports.length > count, count)
    assert.equal((await last()).view, "@v-two,100,50,150z", "a view it can't place leaves the camera where it was")

    const events = () => frame.evaluate(() => window.changes)
    await frame.evaluate(() => {
      window.changes = []
      document.addEventListener("variantchange", (event) => window.changes.push(event.detail.id))
    })
    await hosted.evaluate(() => send({ type: "picker", do: "show", index: 2 }))
    await hosted.waitForFunction(() => reports.at(-1).current === 2 && !reports.at(-1).canvas)
    assert.deepEqual((await look(frame)).shown, ["v-three"])
    await hosted.evaluate(() => send({ type: "picker", do: "next" }))
    await hosted.waitForFunction(() => reports.at(-1).current === 0)
    assert.deepEqual(await events(), ["v-three", "v-one"])
    // Out of range or unknown commands do nothing.
    await hosted.evaluate(() => {
      send({ type: "picker", do: "show", index: 7 })
      send({ type: "picker", do: "constructor" })
    })

    // Keys pressed in the page still switch, and Drop's bar hears it.
    await frame.locator("#v-one").click({ position: { x: 600, y: 4 } })
    await hosted.keyboard.press("2")
    await hosted.waitForFunction(() => reports.at(-1).current === 1)
    await hosted.evaluate(() => send({ type: "picker", do: "canvas" }))
    await hosted.waitForFunction(() => reports.at(-1).canvas)
    assert.deepEqual((await look(frame)).shown, ALL)
    const before = (await last()).zoom
    await hosted.evaluate(() => send({ type: "picker", do: "zoom-out" }))
    await hosted.waitForFunction((zoom) => reports.at(-1).zoom < zoom, before)
    // Drop's bar picks the Hand tool and back, and Space held in Drop's window pans for as long as it's held.
    await hosted.evaluate(() => send({ type: "picker", do: "hand" }))
    await hosted.waitForFunction(() => reports.at(-1).tool === "hand")
    assert.equal(await frame.evaluate(() => document.documentElement.dataset.prototypeHand), "")
    await hosted.evaluate(() => send({ type: "picker", do: "move" }))
    await hosted.waitForFunction(() => reports.at(-1).tool === "move")
    await hosted.evaluate(() => send({ type: "picker", do: "hold" }))
    await frame.waitForFunction(() => document.documentElement.dataset.prototypeHand === "")
    assert.equal((await last()).tool, "move", "Space doesn't change the tool")
    await hosted.evaluate(() => send({ type: "picker", do: "release" }))
    await frame.waitForFunction(() => !("prototypeHand" in document.documentElement.dataset))
  } finally {
    await browser.close()
  }
})

test("a control with data-go draws a labelled arrow to its screen, routed by where that screen lies", async () => {
  const browser = await chromium.launch()
  try {
    const tab = await browser.newPage({ viewport: { width: 1200, height: 800 } })
    const screen = (id, go = "") =>
      `<div data-screen id="${id}" style="width:200px;height:300px;background:#fff">${go}</div>`
    const flows = `<section id="v-flows" data-variant="Flows" data-width="900" style="padding:60px">
      <div style="display:grid;grid-template-columns:200px 200px;gap:120px 200px">
        ${screen("v-flows-a", '<button id="v-flows-pay" data-go="v-flows-b" data-label="Pay" style="margin:100px 20px">Pay</button><button id="v-flows-help" data-go="v-flows-c" data-label="Help">Help</button>')}
        ${screen("v-flows-b", '<button id="v-flows-back" data-go="v-flows-a" data-label="Back">Back</button>')}
        ${screen("v-flows-c")}
      </div></section><section id="v-other" data-variant="Other">other</section>`
    await tab.route("https://picker.test/flows", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: injectRuntime(`<!doctype html><html><body style="margin:0">${flows}</body></html>`, false, 0, true),
      }),
    )
    await tab.goto("https://picker.test/flows")
    // Arrows are measured in the item's own pixels, so the canvas zoom doesn't move them.
    const arrows = () =>
      tab.evaluate(() => {
        const el = document.getElementById("v-flows"),
          k = el.getBoundingClientRect().width / el.offsetWidth
        const box = (id) => {
          const s = el.getBoundingClientRect(),
            r = document.getElementById(id).getBoundingClientRect()
          return { x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k }
        }
        const layer = el.querySelector("[data-drop-flow]")
        return {
          paths: [...layer.querySelectorAll("g path")].map((p) => {
            const t = p.getTotalLength()
            return [p.getPointAtLength(0), p.getPointAtLength(t)].map(({ x, y }) => [Math.round(x), Math.round(y)])
          }),
          labels: [...layer.querySelectorAll("span")].map((s) => s.textContent),
          a: box("v-flows-a"),
          b: box("v-flows-b"),
          c: box("v-flows-c"),
          pay: box("v-flows-pay"),
        }
      })
    await tab.waitForFunction(() => document.querySelectorAll("#v-flows [data-drop-flow] g path").length === 3)
    for (const read of [
      await arrows(),
      await (async () => {
        await tab.keyboard.press("1")
        await tab.waitForTimeout(100)
        return arrows()
      })(),
    ]) {
      const {
        paths: [pay, help, back],
        labels,
        a,
        b,
        c,
        pay: button,
      } = read
      assert.deepEqual(labels, ["Pay", "Help", "Back"])
      // Pay leaves its button's right edge and ends at B's left edge.
      assert.ok(
        Math.abs(pay[0][0] - (button.x + button.w + 6)) <= 1 && Math.abs(pay[0][1] - (button.y + button.h / 2)) <= 1,
        JSON.stringify(pay),
      )
      assert.ok(Math.abs(pay[1][0] - (b.x - 8)) <= 1 && pay[1][1] > b.y && pay[1][1] < b.y + b.h, JSON.stringify(pay))
      // Help goes down to C, below A, entering from the top.
      assert.ok(
        Math.abs(help[1][0] - (c.x + c.w / 2)) <= 1 && Math.abs(help[1][1] - (c.y - 8)) <= 1,
        JSON.stringify(help),
      )
      // Back runs over the top and comes down into A.
      assert.ok(
        back[1][0] > a.x && back[1][0] < a.x + a.w && Math.abs(back[1][1] - (a.y - 8)) <= 1,
        JSON.stringify(back),
      )
    }
    // Hovering a control lights its arrow and dims the others.
    await tab.hover("#v-flows-pay")
    assert.deepEqual(
      await tab.evaluate(() =>
        [...document.querySelectorAll("#v-flows [data-drop-flow] g")].map((g) => g.getAttribute("class") || ""),
      ),
      ["on", "off", "off"],
    )
    assert.equal(await tab.getAttribute("#v-flows-pay", "data-go-on"), "")
    // A control added later gets its arrow.
    await tab.evaluate(() =>
      document
        .getElementById("v-flows-c")
        .insertAdjacentHTML("beforeend", '<button data-go="v-flows-b" data-label="Retry">Retry</button>'),
    )
    await tab.waitForFunction(() => document.querySelectorAll("#v-flows [data-drop-flow] g path").length === 4)
  } finally {
    await browser.close()
  }
})

test("a wheel gesture stays with what it started on: a list stops at its end, and a pan keeps panning over a list", async () => {
  const browser = await chromium.launch()
  try {
    const tab = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    const list = `<div id="v-list-box" style="height:300px;overflow:auto"><div style="height:900px">long</div></div>`
    const html = injectRuntime(
      `<!doctype html><html><body><section id="v-list" data-variant="List" data-width="400" data-height="400">${list}</section><section id="v-two" data-variant="Two" data-width="400">two</section></body></html>`,
      false,
      0,
      true,
    )
    await tab.route("https://picker.test/latch", (route) => route.fulfill({ contentType: "text/html", body: html }))
    await tab.goto("https://picker.test/latch")
    await tab.waitForFunction(() => document.documentElement.dataset.prototypeLayout === "canvas")
    await tab.keyboard.press("0")
    await tab.waitForTimeout(100)
    const camera = () => tab.evaluate(() => document.getElementById("v-list").style.transform)
    const top = () => tab.evaluate(() => document.getElementById("v-list-box").scrollTop)
    const box = await tab.locator("#v-list-box").boundingBox()
    const still = await camera()
    // Scrolling the list past its end in one gesture leaves the camera where it was.
    await tab.mouse.move(box.x + 100, box.y + 100)
    for (let n = 0; n < 12; n++) await tab.mouse.wheel(0, 200)
    await tab.waitForTimeout(50)
    assert.equal(await top(), 600)
    assert.equal(await camera(), still)
    // After a pause, a new wheel over the finished list pans the plane.
    await tab.waitForTimeout(400)
    await tab.mouse.wheel(0, 200)
    await tab.waitForTimeout(50)
    assert.notEqual(await camera(), still)
    // A pan started over empty space keeps panning when the list slides under the pointer.
    await tab.evaluate(() => {
      document.getElementById("v-list-box").scrollTop = 0
    })
    await tab.waitForTimeout(400)
    const panned = await camera()
    await tab.mouse.move(box.x + 100, box.y - 60)
    await tab.mouse.wheel(0, -100)
    await tab.mouse.move(box.x + 100, box.y + 100)
    for (let n = 0; n < 3; n++) await tab.mouse.wheel(0, 100)
    await tab.waitForTimeout(50)
    assert.equal(await top(), 0)
    assert.notEqual(await camera(), panned)
  } finally {
    await browser.close()
  }
})

test("live pages load as their items come near the screen, two at a time, and sleep after a while far away", async () => {
  const browser = await chromium.launch()
  try {
    const tab = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    const sections = Array.from(
      { length: 12 },
      (_, n) =>
        `<section id="v-${n}" data-variant="Page ${n}" data-src="/live/${n}" data-x="${n * 560}" data-y="0" data-width="400" data-height="300"></section>`,
    ).join("")
    const html = injectRuntime(`<!doctype html><html><body>${sections}</body></html>`, false, 0, true)
    // The first two attempts never answer; later navigations can load normally.
    let holdFirstLoads = true
    await tab.route("https://picker.test/**", (route) => {
      const path = new URL(route.request().url()).pathname
      if ((path === "/live/0" || path === "/live/1") && holdFirstLoads) return
      return route.fulfill({
        contentType: "text/html",
        body: path === "/sleep" ? html : `<!doctype html><p>${path}</p>`,
      })
    })
    // The camera at 100% on the first items, so the rest of the row lies far to the right.
    await tab.addInitScript(() => {
      if (self === top)
        localStorage.setItem(
          "drop-prototype-canvas:/sleep",
          JSON.stringify({ v: 1, camera: { x: 48, y: 64, z: 1 }, positions: {} }),
        )
    })
    await tab.clock.install()
    await tab.goto("https://picker.test/sleep", { waitUntil: "domcontentloaded" })
    const loaded = () =>
      tab.evaluate(() =>
        [...document.querySelectorAll("iframe[data-prototype-src]")]
          .filter((f) => f.getAttribute("src"))
          .map((f) => f.parentElement.id),
      )
    const asleep = (id) => tab.evaluate((id) => document.getElementById(id).hasAttribute("data-prototype-asleep"), id)
    // Items 0–2 lie within 600px of the screen. Two load at once; the third waits for one of them.
    await tab.waitForFunction(() => document.querySelectorAll("iframe[data-prototype-src][src]").length === 2, null, {
      polling: 100,
    })
    await tab.clock.fastForward(11000)
    assert.deepEqual(await loaded(), ["v-0", "v-1"])
    // Two pages that never answer give up their turns after a while, stop loading, and wait until their items have
    // left and come back; the third loads meanwhile. The one being typed in keeps loading until focus leaves it.
    await tab.evaluate(() => document.getElementById("v-0").querySelector("iframe").focus())
    await tab.clock.fastForward(5000)
    await tab.waitForFunction(() => document.getElementById("v-2").querySelector("iframe").getAttribute("src"), null, {
      polling: 100,
    })
    assert.deepEqual(await loaded(), ["v-0", "v-2"])
    await tab.evaluate(() => document.activeElement.blur())
    await tab.clock.fastForward(6000)
    await tab.waitForFunction(() => !document.getElementById("v-0").querySelector("iframe").getAttribute("src"), null, {
      polling: 100,
    })
    assert.deepEqual(await loaded(), ["v-2"])
    assert.equal(await asleep("v-0"), true)
    holdFirstLoads = false
    await tab.frameLocator("#v-2 iframe").getByText("/live/2").waitFor()
    assert.deepEqual(await loaded(), ["v-2"])
    assert.equal(await asleep("v-5"), true)

    const panTo = async (id, left = 300) => {
      const currentLeft = await tab.locator(`#${id}`).evaluate((item) => item.getBoundingClientRect().left)
      await tab.mouse.wheel(currentLeft - left, 0)
    }
    // Panning to the far end of the row: the loaded items stay until they've been far away for a while, and the one
    // being typed in stays loaded until focus moves to another page.
    await tab.evaluate(() => document.getElementById("v-2").querySelector("iframe").focus())
    await tab.mouse.move(500, 600)
    await panTo("v-6")
    await tab.waitForFunction(() => document.getElementById("v-6").querySelector("iframe").getAttribute("src"), null, {
      polling: 100,
    })
    await panTo("v-11")
    await tab.waitForFunction(() => document.getElementById("v-11").querySelector("iframe").getAttribute("src"), null, {
      polling: 100,
    })
    await tab.clock.fastForward(6000)
    await tab.waitForFunction(() => !document.getElementById("v-6").querySelector("iframe").getAttribute("src"), null, {
      polling: 100,
    })
    assert.equal(await asleep("v-2"), false)
    await tab.evaluate(() => document.getElementById("v-11").querySelector("iframe").focus())
    await tab.clock.fastForward(6000)
    await tab.waitForFunction(() => !document.getElementById("v-2").querySelector("iframe").getAttribute("src"), null, {
      polling: 100,
    })
    assert.equal(await asleep("v-2"), true)
    assert.equal(
      await tab.evaluate(() => getComputedStyle(document.getElementById("v-2"), "::after").content),
      '"Page 2"',
    )
    assert.equal(await tab.evaluate(() => document.getElementById("v-2").getBoundingClientRect().height), 300)

    // Coming back wakes it, and tries the page that never answered again.
    await panTo("v-0", 48)
    await tab.waitForFunction(
      () => document.getElementById("v-0").querySelector("iframe").getAttribute("src") === "https://picker.test/live/0",
      null,
      { polling: 100 },
    )
    assert.equal(await asleep("v-0"), false)
  } finally {
    await browser.close()
  }
}, 30_000)

for (const reviewing of [false, true]) {
  test(`unrelated stalled previews release their slots during ${reviewing ? "an open thread" : "Comment mode"}`, async () => {
    const browser = await chromium.launch()
    try {
      const tab = await browser.newPage({ viewport: { width: 1100, height: 700 } })
      const host = `<iframe src="/canvas" style="width:1000px;height:600px;border:0"></iframe>`
      const canvas = `<!doctype html><body>${liveItems(3)}
        <script>self.__dropVariantBar = true; ${PICKER}</script>
        <script>addEventListener("message", ({ data }) => { window.lastMessage = data; });</script>`
      await tab.route("https://picker.test/**", (route) => {
        const path = new URL(route.request().url()).pathname
        if (path === "/live/0" || path === "/live/1") return
        return route.fulfill({
          contentType: "text/html",
          body: path === "/" ? host : path === "/canvas" ? canvas : "Healthy",
        })
      })
      await tab.clock.install()
      await tab.goto("https://picker.test/", { waitUntil: "domcontentloaded" })
      const picker = tab.frameLocator("iframe")
      await picker.locator("#v-1 iframe[src]").waitFor({ state: "attached" })
      const frame = tab.frame({ url: "https://picker.test/canvas" })
      const send = (messages) =>
        tab.evaluate((messages) => {
          for (const message of messages)
            document.querySelector("iframe").contentWindow.postMessage({ __drop: true, ...message }, location.origin)
        }, messages)
      await send(
        reviewing
          ? [
              { type: "markers", markers: [{ id: "thread", selector: "#v-0 > iframe" }] },
              { type: "active", id: "thread" },
            ]
          : [{ type: "tool", tool: "comment" }],
      )
      await frame.waitForFunction((type) => window.lastMessage?.type === type, reviewing ? "active" : "tool", {
        polling: 100,
      })
      assert.equal(await picker.locator("#v-2 iframe[src]").count(), 0)
      await tab.clock.fastForward(16000)
      await picker.frameLocator("#v-2 iframe").getByText("Healthy").waitFor()
      assert.equal(await picker.locator("#v-1 [data-prototype-retry]").count(), 1)
      assert.equal(await picker.locator("#v-0 iframe[src]").count(), reviewing ? 1 : 0)
      if (reviewing) {
        await send([{ type: "active", id: null }])
        await frame.waitForFunction(
          () => window.lastMessage?.type === "active" && window.lastMessage.id === null,
          null,
          { polling: 100 },
        )
        await tab.clock.fastForward(6000)
        await picker.locator("#v-0 [data-prototype-retry]").waitFor()
      }
    } finally {
      await browser.close()
    }
  })
}

test("a stalled single preview can retry in Focus without moving the camera", async () => {
  const browser = await chromium.launch()
  try {
    const tab = await browser.newPage()
    let attempts = 0
    await tab.route("https://picker.test/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><body>${liveItems(1)}<script>${PICKER}</script>`,
      }),
    )
    await tab.route("https://picker.test/live/0", (route) => {
      if (++attempts === 1) return
      return route.fulfill({ contentType: "text/html", body: "Recovered" })
    })
    await tab.clock.install()
    const request = tab.waitForRequest("https://picker.test/live/0")
    await tab.goto("https://picker.test/", { waitUntil: "domcontentloaded" })
    await request
    await tab.clock.fastForward(16000)
    const retry = tab.getByRole("button", { name: "Retry preview: Page 0" })
    await retry.waitFor()
    await tab.clock.fastForward(16000)
    assert.equal(attempts, 1)
    await retry.press("Enter")
    await tab.frameLocator("#v-0 iframe").getByText("Recovered").waitFor()
    assert.equal(attempts, 2)
    assert.equal(await retry.count(), 0)
  } finally {
    await browser.close()
  }
})

test("Comments mode protects only the draft's live preview and leaves Retry clickable", async () => {
  const browser = await chromium.launch()
  try {
    const tab = await browser.newPage({ viewport: { width: 1100, height: 700 } })
    const canvas = withVariantBar(injectRuntime(`<!doctype html><body>${liveItems(3)}</body>`, false, 0, true))
    const viewer = `<iframe src="/canvas" style="width:1000px;height:600px;border:0"></iframe>
      <script>window.posts = []; addEventListener("message", (event) => posts.push(event.data));</script>`
    let attempts = 0
    await tab.route("**/*", (route) => {
      const url = new URL(route.request().url())
      if (url.hostname !== "picker.test") return route.abort()
      if (url.pathname === "/slow-image" || (url.pathname === "/live/1" && ++attempts === 1)) return
      const body = {
        "/": viewer,
        "/canvas": canvas,
        "/live/0": '<p>Still loading</p><img src="/slow-image">',
        "/live/1": "Recovered",
        "/live/2": "Healthy",
      }[url.pathname]
      return route.fulfill({ contentType: "text/html", body })
    })
    await tab.clock.install()
    await tab.goto("https://picker.test/", { waitUntil: "domcontentloaded" })
    const picker = tab.frameLocator("iframe")
    await picker.frameLocator("#v-0 iframe").getByText("Still loading").waitFor()
    const send = (message) =>
      tab.evaluate((message) => {
        document.querySelector("iframe").contentWindow.postMessage({ __drop: true, ...message }, location.origin)
      }, message)
    await send({ type: "tool", tool: "comment", clickComments: true })
    await tab.waitForFunction(() => posts.some((post) => post.type === "tool" && post.tool === "comment"))
    const first = picker.locator("#v-0 iframe[src]")
    const bounds = await first.boundingBox()
    await tab.mouse.move(bounds.x + 25, bounds.y + 25)
    await tab.mouse.down()
    await tab.mouse.move(bounds.x + 75, bounds.y + 75, { steps: 3 })
    await tab.mouse.up()
    await tab.waitForFunction(() => posts.some((post) => post.type === "area" && post.selector?.startsWith("#v-0")))
    const draft = picker.locator("drop-comments .draft [data-slot=comment-mark-area]")

    await tab.clock.fastForward(16000)
    await picker.frameLocator("#v-2 iframe").getByText("Healthy").waitFor()
    assert.equal(await first.count(), 1, "the draft is still anchored to the loading iframe")
    assert.equal(await draft.isVisible(), true)
    const retry = picker.getByRole("button", { name: "Retry preview: Page 1" })
    const button = await retry.boundingBox()
    await tab.mouse.click(button.x + button.width / 2, button.y + button.height / 2)
    await picker.frameLocator("#v-1 iframe").getByText("Recovered").waitFor()
    assert.equal(await tab.evaluate(() => posts.filter((post) => post.type === "area").length), 1)

    await send({ type: "clear-area" })
    await draft.waitFor({ state: "detached" })
    await tab.clock.fastForward(6000)
    await picker.getByRole("button", { name: "Retry preview: Page 0" }).waitFor()
  } finally {
    await browser.close()
  }
}, 30_000)
