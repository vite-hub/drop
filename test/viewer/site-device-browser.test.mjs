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

// Mount the actual site frame, device frame and review dock. Only Nuxt services and unrelated UI are stubbed.
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL("../../", import.meta.url))
const components = new Map()
const candidates = []
let styles = readFileSync(require.resolve("tailwindcss/preflight.css"), "utf8")
styles += readFileSync(root + "node_modules/@vite-hub/ui/dist/styles.css", "utf8")
for (const name of ["ViewerSiteFrame", "ViewerDevice", "ViewerReviewDock"]) {
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
  for (const match of descriptor.template.content.matchAll(/class="([^"]*)"/g))
    candidates.push(...match[1].split(/\s+/))
}
const utilities = await compile("@theme { --spacing: .25rem; --breakpoint-sm: 40rem; } @tailwind utilities;")
styles += utilities.build([...candidates, "absolute", "z-30", "fixed", "z-[60]"])

const entry = `
  import * as Vue from "vue"
  import * as VueUse from "@vueuse/core"
  import Site from "ViewerSiteFrame"
  import Device from "ViewerDevice"
  import Dock from "ViewerReviewDock"
  Object.assign(window, Vue, VueUse)
  window.device = Vue.ref({ on: false, id: "iphone", width: 393, height: 852, zoom: null })
  window.useDeviceSize = () => device
  window.useHead = () => {}
  window.useNotify = () => ({})
  window.injectDrop = () => undefined
  window.useTabCapture = () => ({ active: Vue.ref(false), exact: Vue.ref(true) })
  window.injectReviewDraft = () => ({ body: Vue.ref(""), sending: Vue.ref(false), images: { picks: Vue.ref([]) } })
  const app = Vue.createApp({
    setup() {
      const dock = Vue.ref(null)
      return () => [
        Vue.h(Site, { drop: { title: "Site", siteUrl: "https://site.test" }, address: "https://site.test/", reviewing: false, dockTop: dock.value?.top }),
        Vue.h(Dock, { ref: dock, open: false, heading: "none" }, {
          toolbar: () => ["Preview tools", "Device mode", "Comments", "Details", "Share"].map(label =>
            Vue.h("button", { style: { display: "inline-flex", flexShrink: 0 } }, label)),
        }),
      ]
    },
  })
  app.component("ViewerDevice", Device)
  app.component("UButton", { props: ["label", "icon"], setup: (props, { attrs }) => () => Vue.h("button", attrs, props.label || "←") })
  app.component("UInput", { props: ["modelValue"], setup: props => () => Vue.h("input", { value: props.modelValue }) })
  app.mount("#app")
`
const bundle = await build({
  configFile: false,
  logLevel: "silent",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: {
    alias: [
      { find: "#shared", replacement: root + "shared" },
      // ViewerDevice takes DeviceFrame from the UI root, which also loads Nuxt UI's .vue files. Only the frame is mounted here.
      { find: /^vite-hub\/ui$/, replacement: root + "node_modules/@vite-hub/ui/dist/parts/components/device-frame.js" },
    ],
  },
  plugins: [
    {
      name: "site-device-fixture",
      resolveId: (id) => (id.endsWith("fixture") ? "\0fixture" : components.has(id) ? "\0" + id : undefined),
      load: (id) => (id === "\0fixture" ? entry : components.get(id.slice(1))),
    },
  ],
  build: { write: false, lib: { entry: "\0fixture", formats: ["es"] } },
})
const script = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(
  (item) => item.type === "chunk" && item.isEntry,
).code

for (const touch of [true, false])
  test(`site device controls clear the ${touch ? "touch phone" : "desktop"} review dock`, async () => {
    const browser = await chromium.launch()
    try {
      const viewport = touch ? { width: 390, height: 844 } : { width: 1440, height: 900 }
      const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, reducedMotion: "reduce" })
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url())
        if (url.hostname === "site.test")
          return route.fulfill({
            contentType: "text/html",
            body: "<style>body{margin:0;background:#111;color:white}button{position:fixed;bottom:0;left:calc(50% - 50px);width:100px;height:44px}</style><button onclick=\"this.textContent='Clicked'\">Footer</button>",
          })
        if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: script })
        return route.fulfill({
          contentType: "text/html",
          body: `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}
        #app{position:relative;display:flex;flex-direction:column;height:calc(100dvh - 48px);margin-top:48px}
        .review-toolbar{background:white}input{width:100%}</style><div id="app"></div>
        <script>document.documentElement.appendChild(document.createElement('vitehub-pill')).setAttribute('edge','bottom')</script>
        <script type="module" src="/fixture.js"></script>`,
        })
      })
      const page = await context.newPage()
      await page.goto("https://drop.test/")
      const frame = page.locator("iframe")
      await frame.waitFor({ timeout: 5000 })
      assert.equal(
        Math.round((await frame.boundingBox()).y + (await frame.boundingBox()).height),
        viewport.height,
        "ordinary browsing fills the viewer beneath the pill",
      )
      assert.equal(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), touch)
      await page.evaluate(() => (device.value = { ...device.value, on: true }))
      await page.locator(".vh-device-frame[data-on]").waitFor()
      await page.waitForFunction(() => document.querySelector(".vh-device-frame__page").style.transform !== "scale(1)")
      const toolbar = await page.getByRole("group", { name: "Document tools" }).boundingBox()
      if (touch) assert.ok(toolbar.height >= 100, "the default bottom mark wraps the touch dock")
      const grip = page.locator('.vh-device-frame__handle[data-edge="y"]')
      const gripBox = await grip.boundingBox()
      assert.ok(
        gripBox.y + gripBox.height <= toolbar.y,
        `resize grip ends at ${gripBox.y + gripBox.height}, dock starts at ${toolbar.y}`,
      )
      const footer = page.frameLocator("iframe").getByRole("button", { name: "Footer" })
      if (touch) await footer.tap()
      else await footer.click()
      assert.equal(await page.frameLocator("iframe").getByRole("button", { name: "Clicked" }).textContent(), "Clicked")
      assert.equal(
        await grip.evaluate((el) => {
          const rect = el.getBoundingClientRect()
          return (
            document
              .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
              ?.closest('[role="separator"]') === el
          )
        }),
        true,
        "the bottom resize grip is reachable",
      )
    } finally {
      await browser.close()
    }
  }, 30_000)
