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
for (const name of ["ViewerReviewDock", "ViewerCommentsSegment", "ViewerDetailsSegment", "ViewerToolbar"]) {
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
  Object.assign(window, Vue, VueUse)
  window.useHead = () => {}
  const app = Vue.createApp({
    setup() {
      const open = Vue.ref(false)
      const withPrompt = new URL(location.href).searchParams.has("prompt")
      const button = label => Vue.h("button", null, label)
      return () => Vue.h(Dock, { open: false, heading: "none", overlay: true }, {
        toolbar: () => withPrompt ? [
          ...["Drop", "View", "Mark"].map(label => Vue.h("button", { style: { width: "44px" } }, label)),
          Vue.h(Comments, { on: false, count: 1, listOpen: false, canComment: true, canUseMode: true, pins: true, pinsShown: true }, {
            tools: () => Vue.h("button", { "aria-label": "Copy prompt" }),
          }),
          ...["Share", "Tools", "More"].map(label => Vue.h("button", { style: { width: "44px" } }, label)),
        ] : [
          ...["Marker", "Comments", "Share"].map(button),
          Vue.h(Details, {
            open: open.value, "onUpdate:open": value => open.value = value,
            pop: null, meta: "12 KB · 42 views", version: "v2",
            actions: [
              { id: "edit", label: "Edit", icon: "" },
              { id: "window", label: "Open in new window", icon: "", to: "#window" },
              { id: "trash", label: "Move to Trash", icon: "", destructive: true },
            ],
          }, { tools: () => Vue.h(Toolbar, { tool: "browse", sizable: true, views: ["rulers", "xray"] }) }),
        ],
      })
    },
  })
  const passthrough = { setup: (_, { slots }) => () => slots.default?.() }
  app.component("UTooltip", passthrough)
  app.component("UPopover", passthrough)
  app.component("UIcon", { render: () => Vue.h("span") })
  app.component("NuxtLink", { setup: (_, { attrs, slots }) => () => Vue.h("a", { ...attrs, href: "#window" }, slots.default?.()) })
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

async function openDock(page, path = "") {
  await page.route("**/*", (route) =>
    route.fulfill(
      new URL(route.request().url()).pathname === "/fixture.js"
        ? { contentType: "text/javascript", body: script }
        : {
            contentType: "text/html",
            body: `<style>${styles}</style><div id="app"></div>
          <script>document.documentElement.appendChild(document.createElement('vitehub-pill')).setAttribute('edge','bottom')</script>
          <script type="module" src="/fixture.js"></script>`,
          },
    ),
  )
  await page.goto(`https://drop.test/${path}`)
}

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
        "Browse",
        "Measure",
        "Rulers and guides",
        "X-ray",
        "Device mode",
        "Edit",
        "Details",
        "History, v2",
        "Open in new window",
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
      assert.equal(await page.getByRole("button", { name: "Browse", exact: true }).count(), 0)
    } finally {
      await browser.close()
    }
  }, 30_000)
