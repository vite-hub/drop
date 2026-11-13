import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
const { parseFrameMessage } = await import("../../shared/frame-messages.ts")
const { embedDocument, injectRuntime, withVariantBar } = await import("../../shared/plan-runtime.ts")

const PICKER = await readFile(new URL("../../skills/prototype/assets/picker.js", import.meta.url), "utf8")
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
      },
    )
    assert.ok(parseFrameMessage(report), "Drop's viewer accepts what the picker posts")

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
  } finally {
    await browser.close()
  }
})
