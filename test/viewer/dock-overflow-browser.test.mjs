import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { compile } from "tailwindcss"
import { ModuleKind, transpileModule } from "typescript"
import { build } from "vite-plus"
import { test } from "vite-plus/test"
import { compileScript, compileStyle, parse } from "vue/compiler-sfc"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { injectRuntime } from "../../shared/plan-runtime.ts"

const frameHtml = injectRuntime(
  `<!doctype html><button id="trigger">Open tooltip</button>
  <div role="tooltip" hidden>Demand tooltip</div><script>
    const trigger = document.querySelector('#trigger');
    const tip = document.querySelector('[role=tooltip]');
    trigger.addEventListener('click', () => { tip.hidden = false; });
    trigger.addEventListener('blur', () => { tip.hidden = true; });
  </script>`,
  false,
  0,
  true,
)

// Mount the real dock, details segment and nested preview toolbar with their production CSS.
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL("../../", import.meta.url))
const components = new Map()
const candidates = [
  "grid-cols-[1fr]",
  "grid-cols-[0fr]",
  "max-sm:hidden",
  "invisible",
  "flex-wrap",
  "flex-nowrap",
  "[&_[role=group]]:flex-nowrap",
]
let styles = readFileSync(require.resolve("tailwindcss/preflight.css"), "utf8")
styles += readFileSync(root + "node_modules/@vite-hub/ui/dist/styles.css", "utf8")
for (const name of [
  "ViewerReviewDock",
  "ViewerDetailsSegment",
  "ViewerToolbar",
  "ViewerVariants",
  "ViewerCommentsSegment",
]) {
  const { descriptor } = parse(readFileSync(`${root}app/components/viewer/${name}.vue`, "utf8"))
  const id = `data-v-${name}`
  let code = transpileModule(compileScript(descriptor, { id, inlineTemplate: true }).content, {
    compilerOptions: { module: ModuleKind.ESNext },
  }).outputText
  if (descriptor.styles.length) {
    styles += compileStyle({ source: descriptor.styles[0].content, id, scoped: true }).code
    code =
      code.replace("export default", "const component =") + `\ncomponent.__scopeId = "${id}"; export default component`
  }
  components.set(name, code)
  for (const match of descriptor.scriptSetup.content.matchAll(/"([^"]*)"/g)) candidates.push(...match[1].split(/\s+/))
  for (const match of descriptor.template.content.matchAll(/class="([^"]*)"/g))
    candidates.push(...match[1].split(/\s+/))
}
const utilities = await compile(
  "@theme { --spacing: .25rem; --breakpoint-sm: 40rem; --container-3xl: 48rem; } @tailwind utilities;",
)
styles += utilities.build([...candidates, "absolute", "z-30", "fixed", "z-[60]"])

const entry = `
  import * as Vue from "vue"
  import * as VueUse from "@vueuse/core"
  import Dock from "ViewerReviewDock"
  import Comments from "ViewerCommentsSegment"
  import Details from "ViewerDetailsSegment"
  import Toolbar from "ViewerToolbar"
  import Variants from "ViewerVariants"
  Object.assign(window, Vue, VueUse)
  window.useHead = () => {}
  const app = Vue.createApp({
    setup() {
      const open = Vue.ref(false)
      const params = new URL(location.href).searchParams
      const withPrompt = params.has("prompt")
      const zen = params.has("zen")
      const button = label => Vue.h("button", null, label)
      if (zen) return () => Vue.h(Dock, { open: false, heading: "none", overlay: true, folded: true }, {
        handle: () => "Tools",
        toolbar: () => Vue.h("button", { onClick: () => frames[0].postMessage({ __drop: true, type: "tool", tool: "comment" }, "*") }, "Comment"),
      })
      const hasCanvas = params.has("canvas")
      const dock = Vue.ref(null)
      const hand = Vue.ref(params.has("hand"))
      const spacer = () => Vue.h("span", { "aria-hidden": true, class: "w-1 shrink-0 max-sm:hidden" })
      return () => [Vue.h(Dock, { ref: dock, open: false, heading: "none", overlay: true }, {
        toolbar: () => withPrompt ? [
          ...["Drop", "View", "Mark"].map(label => Vue.h("button", { style: { width: "44px" } }, label)),
          Vue.h(Comments, { on: false, count: 1, listOpen: false, canComment: true, canUseMode: true, pins: true, pinsShown: true }, {
            tools: () => Vue.h("button", { "aria-label": "Copy prompt" }),
          }),
          ...["Share", "Tools", "More"].map(label => Vue.h("button", { style: { width: "44px" } }, label)),
        ] : [
          ...["Marker", "Comments", "Share"].map(button).filter(() => !hasCanvas),
          ...(hasCanvas ? [
            Vue.h("a", { href: "/", "aria-label": "Drop", "data-review-home": "", class: "inline-flex items-center justify-center" }, "D"),
            spacer(),
            Vue.h(Variants, {
              state: { canvas: true, zoom: 100, tool: hand.value ? "hand" : "move", current: 0, variants: [{ id: "v-first", label: "First" }] },
              onCommand: command => { (window.commands ??= []).push(command); if (command === "move") hand.value = false },
            }),
            spacer(),
            Vue.h(Toolbar, { tool: "browse", sizable: false, tools: ["mark"], views: [] }),
            Vue.h(Comments, { on: false, count: params.has("pins") ? 42 : 0, canComment: true, canUseMode: true, listOpen: false, pins: params.has("pins"), pinsShown: false, onToggle: () => { window.toggles = (window.toggles ?? 0) + 1 } }),
            spacer(),
            Vue.h("button", { "aria-label": "Share drop", class: "inline-flex shrink-0 items-center" }, [Vue.h("span", { class: "iconify" }), Vue.h("span", { class: "review-share-label" }, "Share")]),
          ] : []),
          Vue.h(Details, {
            open: open.value, "onUpdate:open": value => open.value = value,
            pop: false, chip: "v2 · 42 views", details: true, history: true,
            actions: [
              { id: "edit", label: "Edit", icon: "" },
              { id: "download", label: "Download original", icon: "", to: "#download" },
              { id: "trash", label: "Move to Trash", icon: "", destructive: true },
            ],
          }, { tools: () => Vue.h(Toolbar, { tool: "browse", sizable: true, tools: ["measure"], views: ["rulers", "xray"] }) }),
        ],
      }), Vue.h("output", { id: "dock-top", hidden: true }, dock.value?.top)]
    },
  })
  const passthrough = { setup: (_, { slots }) => () => slots.default?.() }
  app.component("UTooltip", passthrough)
  app.component("UPopover", passthrough)
  app.component("UDropdownMenu", passthrough)
  app.component("UIcon", { render: () => Vue.h("span", { class: "iconify" }) })
  app.component("NuxtLink", { setup: (_, { attrs, slots }) => () => Vue.h("a", { ...attrs, href: "#download" }, slots.default?.()) })
  app.component("ViewerDeviceButton", { render: () => Vue.h("button", { "aria-label": "Device mode" }, "Device") })
  app.mount("#app")
`
const bundle = await build({
  configFile: false,
  logLevel: "silent",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [
    {
      name: "dock-fixture",
      resolveId: (id) => (id.endsWith("fixture") ? "\0fixture" : components.has(id) ? "\0" + id : undefined),
      load: (id) => (id === "\0fixture" ? entry : components.get(id.slice(1))),
    },
  ],
  build: { write: false, lib: { entry: "\0fixture", formats: ["es"] } },
})
const script = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(
  (item) => item.type === "chunk" && item.isEntry,
).code

test("collapsed prototype tools stay on one row with full phone touch targets", async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({
      viewport: { width: 320, height: 600 },
      hasTouch: true,
      reducedMotion: "reduce",
    })
    for (const width of [320, 375, 393, 430]) {
      await page.setViewportSize({ width, height: 600 })
      for (const hand of [false, true]) {
        await openDock(page, `?canvas${hand ? "&hand" : ""}`)
        const dock = page.getByRole("group", { name: "Document tools" })
        await dock.getByRole("button", { name: "More", exact: true }).waitFor()
        const bounds = []
        for (const label of [
          "Drop",
          "Zoom, 100%",
          "Marker",
          "Comments",
          "Share drop",
          "More",
          ...(hand ? ["Hand"] : []),
        ]) {
          const control = dock.getByRole(label === "Drop" ? "link" : "button", { name: label, exact: true })
          const rect = await control.boundingBox()
          assert.ok(rect && rect.width >= 44 && rect.height >= 44, `${width}px: ${label} has a full touch target`)
          assert.ok(rect.x >= 0 && rect.x + rect.width <= width, `${width}px: ${label} is within the viewport`)
          bounds.push(rect)
        }
        assert.ok(
          bounds.every((rect) => rect.y === bounds[0].y),
          `${width}px: all primary controls on the same row`,
        )
        if (hand) {
          await dock.getByRole("button", { name: "Hand", exact: true }).tap()
          assert.equal(await dock.getByRole("button", { name: "Hand", exact: true }).count(), 0)
        }
      }
    }
  } finally {
    await browser.close()
  }
}, 30_000)

test("on the canvas, Space on a clicked Comments button holds the Hand; on one reached with Tab it presses it", async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 }, reducedMotion: "reduce" })
    await openDock(page, "?canvas")
    const comments = page
      .getByRole("group", { name: "Document tools" })
      .getByRole("button", { name: "Comments", exact: true })
    await comments.click()
    assert.equal(await page.evaluate(() => window.toggles), 1)
    assert.equal(await comments.evaluate((button) => button === document.activeElement), true)
    await page.keyboard.down(" ")
    await page.keyboard.down(" ")
    await page.keyboard.up(" ")
    assert.deepEqual(await page.evaluate(() => window.commands), ["hold", "release"])
    assert.equal(await page.evaluate(() => window.toggles), 1, "Space didn't press Comments")

    // Put back by Drop, as after a comment is sent, it still holds the Hand.
    await comments.evaluate((button) => button.blur())
    await page.keyboard.press("Enter")
    await comments.focus()
    await page.keyboard.press(" ")
    assert.deepEqual(await page.evaluate(() => window.commands), ["hold", "release", "hold", "release"])
    assert.equal(await page.evaluate(() => window.toggles), 1)

    // Reached with Tab, Space presses it.
    await comments.evaluate((button) => button.blur())
    for (let i = 0; i < 20 && !(await comments.evaluate((button) => button === document.activeElement)); i++)
      await page.keyboard.press("Tab")
    await page.keyboard.press(" ")
    assert.equal(await page.evaluate(() => window.toggles), 2)
    assert.deepEqual(await page.evaluate(() => window.commands), ["hold", "release", "hold", "release"])
  } finally {
    await browser.close()
  }
})

test("the phone canvas dock reports its top as a bottom ViteHub mark appears, moves, or disappears", async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, hasTouch: true })
    await openDock(page, "?canvas&noMark")
    const toolbar = page.getByRole("group", { name: "Document tools" })
    await toolbar.getByRole("button", { name: "Zoom, 100%", exact: true }).waitFor()
    const initial = await toolbar.boundingBox()
    assert.ok(initial)
    async function expectTop(offset) {
      const bounds = await toolbar.boundingBox()
      assert.ok(bounds)
      assert.equal(bounds.y, initial.y + offset)
      assert.equal(bounds.width, initial.width)
      assert.equal(bounds.height, initial.height)
      await page.waitForFunction((top) => Number(document.querySelector("#dock-top").textContent) === top, bounds.y, {
        timeout: 3000,
      })
    }
    await expectTop(0)
    for (const tag of ["vitehub-tools-off", "vitehub-pill"]) {
      await page.evaluate((tag) => {
        const mark = document.createElement(tag)
        mark.setAttribute("edge", "bottom")
        document.documentElement.appendChild(mark)
      }, tag)
      await expectTop(-48)
      for (const edge of ["right", "bottom"]) {
        await page.locator(tag).evaluate((mark, edge) => mark.setAttribute("edge", edge), edge)
        await expectTop(edge === "right" ? 0 : -48)
      }
      await page.locator(tag).evaluate((mark) => mark.remove())
      await expectTop(0)
    }
  } finally {
    await browser.close()
  }
})

async function openDock(page, path = "") {
  await page.unroute("**/*")
  await page.route("**/*", (route) =>
    route.fulfill(
      new URL(route.request().url()).pathname === "/fixture.js"
        ? { contentType: "text/javascript", body: script }
        : new URL(route.request().url()).pathname === "/frame"
          ? { contentType: "text/html; charset=utf-8", body: frameHtml }
          : {
              contentType: "text/html",
              body: `<style>${styles}</style><div id="app"></div>
          ${path === "?zen" ? `<button id="outside">Outside</button><iframe title="Preview" sandbox="${PREVIEW_SANDBOX}" src="/frame"></iframe>` : ""}
          <script>window.posts = []; addEventListener("message", (event) => {
            if (event.source === frames[0] && event.data?.__drop) window.posts.push(event.data);
          });</script>
          ${new URLSearchParams(path).has("noMark") ? "" : "<script>document.documentElement.appendChild(document.createElement('vitehub-pill')).setAttribute('edge','bottom')</script>"}
          <script type="module" src="/fixture.js"></script>`,
            },
    ),
  )
  await page.goto(`https://drop.test/${path}`)
}

test("revealing Zen tools preserves a tooltip while starting a comment", async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await openDock(page, "?zen")
    const frame = page.frameLocator("iframe")
    const tip = frame.getByRole("tooltip")
    const trigger = frame.getByRole("button", { name: "Open tooltip" })
    await page.waitForFunction(() => window.posts.some((message) => message.type === "ready"))
    await trigger.click()
    await tip.waitFor({ state: "visible" })
    await page.getByRole("button", { name: "Show tools" }).click()
    assert.equal(await trigger.evaluate((button) => button === document.activeElement), true)
    assert.equal(await tip.isVisible(), true)
    await page.getByRole("button", { name: "Comment" }).click()
    await page.waitForFunction(() =>
      window.posts.some((message) => message.type === "tool" && message.tool === "comment"),
    )
    await page.getByRole("button", { name: "Outside" }).focus()
    assert.equal(await tip.isVisible(), true)
  } finally {
    await browser.close()
  }
}, 30_000)

test("a keyboard peek keeps toolbar focus until focus leaves", async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await openDock(page, "?zen")
    const handle = page.getByRole("button", { name: "Show tools" })
    await handle.press("Enter")
    const comment = page.getByRole("button", { name: "Comment" })
    await comment.hover()
    const outside = page.getByRole("button", { name: "Outside" })
    await outside.hover()
    assert.equal(await comment.evaluate((button) => button === document.activeElement), true)
    await outside.focus()
    await handle.waitFor({ state: "visible" })
    assert.equal(await comment.count(), 0)
  } finally {
    await browser.close()
  }
}, 30_000)

test("comment tools wrap independently on phones and share a track on wider docks", async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 600 }, hasTouch: true })
    await openDock(page, "?prompt")
    const toolbar = page.getByRole("group", { name: "Document tools" })
    const copy = toolbar.getByRole("button", { name: "Copy prompt" })
    await copy.waitFor()
    const rows = await toolbar
      .getByRole("button")
      .evaluateAll((buttons) => new Set(buttons.map((button) => button.getBoundingClientRect().top)).size)
    assert.equal(rows, 2)
    const track = toolbar.locator(".comment-track")
    assert.equal(await track.evaluate((el) => getComputedStyle(el).display), "contents")
    await page.setViewportSize({ width: 1280, height: 600 })
    assert.equal(await track.evaluate((el) => getComputedStyle(el).display), "flex")
  } finally {
    await browser.close()
  }
}, 30_000)

for (const width of [320, 640, 667, 1440])
  test(`expanded dock actions remain tappable at ${width}px with history and the bottom mark`, async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width, height: 600 }, hasTouch: true, reducedMotion: "reduce" })
      await openDock(page)
      await page.getByRole("button", { name: "More", exact: true }).click()
      for (const label of [
        "Measure",
        "Rulers and guides",
        "X-ray",
        "Device mode",
        "Edit",
        "Details and history, v2 · 42 views",
        "Download original",
        "Move to Trash",
      ]) {
        const control = page.getByLabel(label, { exact: true })
        assert.equal(
          await control.evaluate((el) => {
            const rect = el.getBoundingClientRect()
            return [2, rect.width / 2, rect.width - 2].every((x) => {
              const hit = document.elementFromPoint(rect.x + x, rect.y + rect.height / 2)
              return hit === el || el.contains(hit)
            })
          }),
          true,
          label + " is fully reachable",
        )
        await control.tap()
      }
      await page.getByRole("button", { name: "Close", exact: true }).click()
      assert.equal(await page.getByRole("button", { name: "Measure", exact: true }).count(), 0)
    } finally {
      await browser.close()
    }
  }, 30_000)
