import assert from "node:assert/strict"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { createServer } from "vite-plus"
import { test } from "vite-plus/test"
import { compileScript, parse } from "vue/compiler-sfc"
import { transpileModule, ModuleKind } from "typescript"

const root = fileURLToPath(new URL("../../node_modules/.cache/pdf-browser/", import.meta.url))
const source = readFileSync(new URL("../../app/components/viewer/ViewerPdf.vue", import.meta.url), "utf8")
const { descriptor } = parse(source)
rmSync(root, { force: true, recursive: true })
mkdirSync(root, { recursive: true })
writeFileSync(
  `${root}viewer.js`,
  transpileModule(compileScript(descriptor, { id: "pdf", inlineTemplate: true }).content, {
    compilerOptions: { module: ModuleKind.ESNext },
  }).outputText,
)
writeFileSync(
  `${root}index.html`,
  '<style>.pdf-pane { position: absolute; inset: 0; overflow: auto }</style><div id="app"></div><script type="module" src="/main.js"></script>',
)
writeFileSync(
  `${root}main.js`,
  `
import * as Vue from "vue"
import * as VueUse from "@vueuse/core"
import Viewer from "./viewer.js"
Object.assign(window, Vue, VueUse)
window.useNotify = () => ({ alert: console.error })
window.reportClientError = console.error
const add = document.addEventListener.bind(document)
window.copySignals = []
document.addEventListener = (type, fn, options) => {
  if (type === "copy") copySignals.push(options?.signal)
  return add(type, fn, options)
}
const component = Vue.ref()
const visible = Vue.ref(true)
window.unmount = async () => { visible.value = false; await Vue.nextTick() }
window.snapshot = () => component.value.pageAt()
const app = Vue.createApp({ render: () => visible.value ? Vue.h(Viewer, {
  ref: component, src: "/fixture.pdf", title: "JPEG2000", canComment: true,
}) : null })
for (const name of ["UTooltip", "UButton", "USeparator", "UIcon"]) {
  app.component(name, { setup: (_, { slots }) => () => Vue.h("span", slots.default?.()) })
}
app.mount("#app")
`,
)

// Generated locally with ffmpeg's JPEG2000 encoder: a solid red image, embedded with /JPXDecode.
const fixture = readFileSync(new URL("./fixtures/jpx.pdf", import.meta.url))

test(
  "PDF image decoders render pages and comment snapshots, and unmount releases listeners and canvases",
  { timeout: 60_000 },
  async () => {
    const server = await createServer({
      configFile: false,
      root,
      logLevel: "warn",
      optimizeDeps: { noDiscovery: true },
      resolve: { dedupe: ["vue"] },
      server: { host: "127.0.0.1", port: 0 },
    })
    const browser = await chromium.launch()
    try {
      await server.listen()
      const page = await browser.newPage()
      await page.route("**/fixture.pdf", (route) => route.fulfill({ contentType: "application/pdf", body: fixture }))
      // Serve the same directory registered as a Nitro public asset in nuxt.config.ts.
      await page.route("**/vendor/pdfjs/wasm/*", (route) =>
        route.fulfill({
          path: fileURLToPath(
            new URL(
              `../../node_modules/pdfjs-dist/wasm/${new URL(route.request().url()).pathname.split("/").at(-1)}`,
              import.meta.url,
            ),
          ),
          contentType: route.request().url().endsWith(".wasm") ? "application/wasm" : "text/javascript",
        }),
      )
      await page.goto(server.resolvedUrls.local[0])
      await page.waitForFunction(() => {
        const canvas = document.querySelector(".page canvas")
        if (!canvas) return false
        const pixel = canvas.getContext("2d").getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data
        return pixel[0] > 180 && pixel[1] < 100 && pixel[2] < 100
      })
      assert.equal(
        await page.evaluate(async () => {
          const still = await snapshot()
          const img = new Image()
          img.src = still.src
          await img.decode()
          const canvas = document.createElement("canvas")
          canvas.width = img.width
          canvas.height = img.height
          const ctx = canvas.getContext("2d")
          ctx.drawImage(img, 0, 0)
          const pixel = ctx.getImageData(img.width / 2, img.height / 2, 1, 1).data
          return pixel[0] > 180 && pixel[1] < 100 && pixel[2] < 100 && still.file.size > 0
        }),
        true,
      )
      assert.equal(
        await page.evaluate(async () => {
          const pane = document.querySelector(".pdf-pane")
          const canvases = [...pane.querySelectorAll("canvas")]
          const signals = [...copySignals]
          await unmount()
          return (
            signals.length > 0 &&
            signals.every((signal) => signal.aborted) &&
            pane.querySelectorAll("canvas").length === 0 &&
            canvases.length > 0 &&
            canvases.every((canvas) => !canvas.isConnected && !pane.contains(canvas))
          )
        }),
        true,
      )
    } finally {
      await browser.close()
      await server.close()
    }
  },
)
