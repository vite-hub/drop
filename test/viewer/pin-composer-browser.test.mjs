import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { createServer } from "vite-plus"
import { test } from "vite-plus/test"
import { compileScript, parse } from "vue/compiler-sfc"
import { transpileModule, ModuleKind } from "typescript"

// Mount the real compact composer, with ViteHub's CommentComposer inside it, in a browser without the rest of the Nuxt
// viewer. Vite serves it so "vite-hub/ui" and "#shared" resolve as in the app; Nuxt's auto-imports are page globals.
const source = readFileSync(new URL("../../app/components/viewer/ViewerPinComposer.vue", import.meta.url), "utf8")
const { descriptor } = parse(source)
const component = transpileModule(compileScript(descriptor, { id: "pin-composer", inlineTemplate: true }).content, {
  compilerOptions: { module: ModuleKind.ESNext },
}).outputText
const root = fileURLToPath(new URL("../../node_modules/.cache/pin-composer-browser/", import.meta.url))
mkdirSync(root, { recursive: true })
writeFileSync(`${root}composer.js`, component)
writeFileSync(`${root}index.html`, '<div id="app"></div><script type="module" src="/main.js"></script>')
writeFileSync(
  `${root}main.js`,
  `import * as Vue from "vue"
  import Composer from "./composer.js"
  Object.assign(window, Vue)
  const picks = Vue.shallowRef([])
  const add = files => { picks.value = [...picks.value, ...files.map(file => ({ file, url: URL.createObjectURL(file) }))] }
  const remove = pick => { picks.value = picks.value.filter(item => item !== pick) }
  const images = {
    picks,
    add,
    remove,
    problem: Vue.ref(),
    files: Vue.computed({
      get: () => picks.value.map(pick => pick.file),
      set: next => {
        for (const pick of picks.value) if (!next.includes(pick.file)) remove(pick)
        const added = next.filter(file => !picks.value.some(pick => pick.file === file))
        if (added.length) add(added)
      },
    }),
  }
  window.draft = { body: Vue.ref(""), images, waiting: Vue.ref(false), sending: Vue.ref(false) }
  window.injectReviewDraft = () => draft
  window.injectDropComments = () => ({ user: { id: "me", name: "Me" }, users: async () => [] })
  window.submissions = []
  window.cancellations = 0
  window.unhandledEscapes = 0
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") unhandledEscapes++
  })
  const app = Vue.createApp(Composer, {
    onSubmit: (body, files) => {
      submissions.push({ body, files: files.map(file => file.name) })
      draft.waiting.value = true
    },
    onCancel: () => {
      cancellations++
      draft.body.value = ""
      picks.value = []
    },
  })
  app.component("UButton", {
    inheritAttrs: false,
    props: ["loading", "disabled", "icon", "size", "color", "variant", "square", "label"],
    setup: (props, { attrs, slots }) => () =>
      Vue.h("button", { ...attrs, disabled: props.disabled || props.loading }, slots.default?.() ?? props.label ?? "Send"),
  })
  app.component("UIcon", { render: () => Vue.h("span") })
  app.mount("#app")`,
)

async function open(browser) {
  const server = await createServer({
    configFile: false,
    root,
    logLevel: "warn",
    optimizeDeps: { noDiscovery: true },
    resolve: { alias: { "#shared": fileURLToPath(new URL("../../shared", import.meta.url)) }, dedupe: ["vue"] },
    server: { host: "127.0.0.1", port: 0 },
  })
  await server.listen()
  const page = await browser.newPage()
  page.on("close", () => void server.close())
  await page.goto(server.resolvedUrls.local[0])
  await page.locator("textarea").waitFor()
  return page
}

const pastePicture = (page, name) =>
  page.locator("textarea").evaluate((field, name) => {
    const clipboard = new DataTransfer()
    clipboard.items.add(new File([name], name, { type: "image/png" }))
    field.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, cancelable: true, bubbles: true }))
  }, name)

test(
  "compact drafts stay unchanged while waiting for a screenshot or sending, then become editable again",
  { timeout: 60_000 },
  async () => {
    const browser = await chromium.launch()
    try {
      const page = await open(browser)
      const field = page.locator("textarea")
      await field.fill("Keep this feedback")
      await pastePicture(page, "original.png")
      await field.press("Enter")
      assert.deepEqual(await page.evaluate(() => submissions), [
        { body: "Keep this feedback", files: ["original.png"] },
      ])

      for (const phase of ["waiting", "sending"]) {
        if (phase === "sending")
          await page.evaluate(() => {
            // A frame screenshot must still join the draft while user mutation is locked.
            draft.images.add([new File(["shot"], "shot.png", { type: "image/png" })])
            draft.sending.value = true
            draft.waiting.value = false
          })
        await field.focus()
        await field.press("End")
        await field.pressSequentially(" edits during " + phase)
        await page
          .getByRole("button", { name: /^Remove / })
          .first()
          .click({ force: true })
        await pastePicture(page, "replacement.png")
        await field.press("Escape")
        assert.equal(await page.evaluate(() => cancellations), 0, phase)
        assert.equal(await page.evaluate(() => unhandledEscapes), 0, phase)
        assert.equal(await field.inputValue(), "Keep this feedback", phase)
        assert.deepEqual(
          await page.evaluate(() => draft.images.files.value.map((file) => file.name)),
          phase === "waiting" ? ["original.png"] : ["original.png", "shot.png"],
          phase,
        )
      }

      // A failed send releases the controls without losing the original draft or its screenshot.
      await page.evaluate(() => {
        draft.sending.value = false
      })
      await field.press("End")
      await field.pressSequentially(" retry")
      await page
        .getByRole("button", { name: /^Remove / })
        .first()
        .click()
      await pastePicture(page, "replacement.png")
      await field.press("Enter")
      assert.deepEqual(await page.evaluate(() => submissions.at(-1)), {
        body: "Keep this feedback retry",
        files: ["shot.png", "replacement.png"],
      })

      // Escape still discards an idle draft once the submission is no longer in flight: the first press asks, the second
      // discards, as in every ViteHub comment box.
      await page.evaluate(() => {
        draft.waiting.value = false
      })
      await page.waitForTimeout(2100)
      await field.press("Escape")
      assert.equal(await page.evaluate(() => cancellations), 0)
      await field.press("Escape")
      assert.equal(await page.evaluate(() => cancellations), 1)
      assert.equal(await field.inputValue(), "")
      assert.deepEqual(await page.evaluate(() => draft.images.files.value), [])
    } finally {
      await browser.close()
    }
  },
)
