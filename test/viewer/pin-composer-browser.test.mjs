import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { compileScript, parse } from "vue/compiler-sfc"
import { transpileModule, ModuleKind } from "typescript"

// Mount the real compact composer with Vue in a browser, without the rest of the Nuxt viewer.
const require = createRequire(import.meta.url)
const vue = readFileSync(require.resolve("vue/dist/vue.esm-browser.prod.js"), "utf8")
const source = readFileSync(new URL("../../app/components/viewer/ViewerPinComposer.vue", import.meta.url), "utf8")
const { descriptor } = parse(source)
const component = transpileModule(compileScript(descriptor, { id: "pin-composer", inlineTemplate: true }).content, {
  compilerOptions: { module: ModuleKind.ESNext },
}).outputText

async function open(browser) {
  const context = await browser.newContext()
  await context.route("https://drop.test/**", (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/vue.js" || path === "/composer.js")
      return route.fulfill({ contentType: "text/javascript", body: path === "/vue.js" ? vue : component })
    return route.fulfill({
      contentType: "text/html",
      body: `<div id="app"></div><script type="importmap">{"imports":{"vue":"/vue.js"}}</script>
        <script type="module">
          import * as Vue from "vue"
          import Composer from "/composer.js"
          Object.assign(window, Vue)
          const picks = Vue.shallowRef([])
          const images = {
            picks,
            files: Vue.computed(() => picks.value.map(pick => pick.file)),
            add: files => { picks.value = [...picks.value, ...files.map(file => ({ file, url: URL.createObjectURL(file) }))] },
            remove: pick => { picks.value = picks.value.filter(item => item !== pick) },
          }
          window.draft = { body: Vue.ref(""), images, waiting: Vue.ref(false), sending: Vue.ref(false) }
          window.injectReviewDraft = () => draft
          window.submissions = []
          const app = Vue.createApp(Composer, { onSubmit: (body, files) => {
            submissions.push({ body, files: files.map(file => file.name) })
            draft.waiting.value = true
          } })
          app.component("UButton", {
            props: ["loading", "disabled", "icon", "size"],
            setup: (props, { attrs }) => () => Vue.h("button", { ...attrs, disabled: props.disabled || props.loading }, "Send"),
          })
          app.component("UIcon", { render: () => Vue.h("span") })
          app.mount("#app")
        </script>`,
    })
  })
  const page = await context.newPage()
  await page.goto("https://drop.test/")
  await page.locator("textarea").waitFor()
  return page
}

const pastePicture = (page, name) =>
  page.locator("textarea").evaluate((field, name) => {
    const clipboard = new DataTransfer()
    clipboard.items.add(new File([name], name, { type: "image/png" }))
    field.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, cancelable: true, bubbles: true }))
  }, name)

test("compact drafts stay unchanged while waiting for a screenshot or sending, then become editable again", async () => {
  const browser = await chromium.launch()
  try {
    const page = await open(browser)
    const field = page.locator("textarea")
    await field.fill("Keep this feedback")
    await pastePicture(page, "original.png")
    await field.press("Enter")
    assert.deepEqual(await page.evaluate(() => submissions), [{ body: "Keep this feedback", files: ["original.png"] }])

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
      await page.getByRole("button", { name: "Remove picture" }).first().click({ force: true })
      await pastePicture(page, "replacement.png")
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
    await page.getByRole("button", { name: "Remove picture" }).first().click()
    await pastePicture(page, "replacement.png")
    await field.press("Enter")
    assert.deepEqual(await page.evaluate(() => submissions.at(-1)), {
      body: "Keep this feedback retry",
      files: ["shot.png", "replacement.png"],
    })
  } finally {
    await browser.close()
  }
})
