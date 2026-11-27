import assert from "node:assert/strict"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
// A cache from another ViteHub build would serve stale pre-bundled files.
rmSync(root, { force: true, recursive: true })
mkdirSync(root, { recursive: true })
writeFileSync(`${root}composer.js`, component)
writeFileSync(
  `${root}draft.js`,
  transpileModule(readFileSync(new URL("../../app/composables/useReviewDraft.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ModuleKind.ESNext },
  }).outputText,
)
const dockSource = readFileSync(new URL("../../app/components/viewer/ViewerCommentThread.vue", import.meta.url), "utf8")
writeFileSync(
  `${root}dock.js`,
  transpileModule(compileScript(parse(dockSource).descriptor, { id: "dock-composer", inlineTemplate: true }).content, {
    compilerOptions: { module: ModuleKind.ESNext },
  }).outputText,
)
writeFileSync(`${root}composer.css`, descriptor.styles.map((style) => style.content).join("\n"))
// The pictures fan out above the box, as they do over a page, so leave them room.
writeFileSync(
  `${root}index.html`,
  '<div id="app" style="padding-top: 12rem"></div><script type="module" src="/main.js"></script>',
)
writeFileSync(
  `${root}main.js`,
  `import * as Vue from "vue"
  import Composer from "./composer.js"
  import Dock from "./dock.js"
  import { createInjectionState } from "@vueuse/core"
  import "vite-hub/ui/styles.css"
  import "./composer.css"
  Object.assign(window, Vue)
  const picks = Vue.shallowRef([])
  const add = files => { picks.value = [...picks.value, ...files.map(file => ({ file, url: URL.createObjectURL(file) }))] }
  const remove = pick => { picks.value = picks.value.filter(item => item !== pick) }
  const images = {
    picks,
    add,
    remove,
    problem: Vue.ref(),
    clear: () => { picks.value = [] },
    files: Vue.computed({
      get: () => picks.value.map(pick => pick.file),
      set: next => {
        for (const pick of picks.value) if (!next.includes(pick.file)) remove(pick)
        const added = next.filter(file => !picks.value.some(pick => pick.file === file))
        if (added.length) add(added)
      },
    }),
  }
  window.createInjectionState = createInjectionState
  window.useImagePicks = () => images
  const { provideReviewDraft, injectReviewDraft } = await import("./draft.js")
  window.injectReviewDraft = injectReviewDraft
  window.useVersionTo = () => () => ""
  window.injectDrop = () => ({})
  window.guest = false
  window.injectDropComments = () => ({ people: Vue.ref([]), user: window.guest ? undefined : { id: "me", name: "Me" }, users: async () => window.guest ? [] : [{ id: "ana", name: "Ana Ruiz" }] })
  window.submissions = []
  window.cancellations = 0
  window.unhandledEscapes = 0
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") unhandledEscapes++
  })
  const dock = Vue.ref(false)
  const visible = Vue.ref(true)
  window.replaceComposer = async (inDock = true) => { visible.value = false; await Vue.nextTick(); dock.value = inDock; visible.value = true; await Vue.nextTick() }
  const app = Vue.createApp({ setup() { window.draft = provideReviewDraft() }, render: () => visible.value ? Vue.h(dock.value ? Dock : Composer, {
    ...(dock.value ? { pending: { kind: "page", selector: "" } } : {}),
    onSubmit: (body, files, mentions) => {
      submissions.push({ body, files: files.map(file => file.name), ...(mentions.length ? { mentions } : {}) })
      // As DropViewer does: the comment goes to the outbox and the draft starts over.
      draft.clear()
      draft.mentions.value = []
    },
    onCancel: () => {
      cancellations++
      draft.body.value = ""
      picks.value = []
    },
  }) : null })
  app.component("UButton", {
    inheritAttrs: false,
    props: ["loading", "disabled", "icon", "size", "color", "variant", "square", "label"],
    setup: (props, { attrs, slots }) => () =>
      Vue.h("button", { ...attrs, disabled: props.disabled || props.loading }, slots.default?.() ?? props.label ?? "Send"),
  })
  app.component("UIcon", { render: () => Vue.h("span") })
  // Attachment thumbnails use UModal. Keep this Nuxt UI shell local, like UButton and UIcon, so the
  // standalone Vite fixture does not try to load an uncompiled Nuxt SFC after a picture is attached.
  app.component("UModal", { setup: (_, { slots }) => () => slots.default?.() })
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

test("a compact draft sends at once and the next comment starts empty", { timeout: 60_000 }, async () => {
  const browser = await chromium.launch()
  try {
    const page = await open(browser)
    const field = page.locator("textarea")
    // The bubble around the box is its frame, so the box draws no edge of its own on focus (Drop comment #14).
    const box = page.locator('[data-slot="comment-composer"]')
    assert.equal(await box.getAttribute("data-frame"), "none")
    assert.equal(await box.getAttribute("data-size"), "sm")
    await field.focus()
    const group = page.locator('[data-slot="prompt-input-group"]')
    assert.equal(await group.evaluate((element) => getComputedStyle(element).borderTopColor), "rgba(0, 0, 0, 0)")
    await field.fill("Keep this feedback")
    await pastePicture(page, "original.png")
    await field.press("Enter")
    assert.deepEqual(await page.evaluate(() => submissions), [{ body: "Keep this feedback", files: ["original.png"] }])
    assert.equal(await field.inputValue(), "")
    assert.deepEqual(await page.evaluate(() => draft.images.files.value), [])

    // Nothing waits on the first: the next comment takes text and pictures and sends too.
    await field.pressSequentially("And the next")
    await pastePicture(page, "next.png")
    await field.press("Enter")
    assert.deepEqual(await page.evaluate(() => submissions.at(-1)), { body: "And the next", files: ["next.png"] })
    assert.equal(await field.inputValue(), "")

    // Escape discards an idle draft: the first press asks, the second discards, as in every ViteHub comment box.
    await field.fill("Not this one")
    await page.waitForTimeout(2100)
    await field.press("Escape")
    assert.equal(await page.evaluate(() => cancellations), 0)
    await field.press("Escape")
    assert.equal(await page.evaluate(() => cancellations), 1)
    assert.equal(await page.evaluate(() => unhandledEscapes), 0)
    assert.equal(await field.inputValue(), "")
  } finally {
    await browser.close()
  }
})

test(
  "mention choices remain visible, survive replacement, and Send leaves the draft empty",
  { timeout: 60_000 },
  async () => {
    const browser = await chromium.launch()
    try {
      const page = await open(browser)
      await page.locator("#app").evaluate((el) => {
        Object.assign(el.style, { width: "288px", maxHeight: "300px", overflowY: "auto" })
      })
      const field = page.locator("textarea")
      await field.fill("@An")
      const option = page.getByRole("option").filter({ hasText: "Ana Ruiz" })
      await option.waitFor()
      assert.equal(
        await option.evaluate((el) => {
          const rect = el.getBoundingClientRect()
          return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
        }),
        true,
      )
      await option.click()
      await pastePicture(page, "retained.png")
      await page.evaluate(() => replaceComposer())
      assert.match(await field.inputValue(), /@Ana Ruiz/)
      await page.getByRole("button", { name: "Comment", exact: true }).click()
      assert.deepEqual(await page.evaluate(() => submissions.at(-1).mentions), ["ana"])
      assert.deepEqual(await page.evaluate(() => submissions.at(-1).files), ["retained.png"])
      assert.equal(await field.inputValue(), "")
      assert.deepEqual(await page.evaluate(() => draft.mentions.value), [])

      // Send with a lookup still open sends what was typed and empties the draft.
      await page.evaluate(() => replaceComposer(false))
      await field.fill("@An")
      await option.waitFor()
      await page.getByRole("button", { name: "Comment", exact: true }).click()
      assert.equal(await page.evaluate(() => submissions.at(-1).body), "@An")
      assert.equal(await field.inputValue(), "")
      assert.deepEqual(await page.evaluate(() => draft.mentions.value), [])
    } finally {
      await browser.close()
    }
  },
)

// Two Vite servers and a browser start inside it, which takes more than the default 5 s on a busy CI runner.
test(
  "immediate guest lookups preserve native keyboard input in compact and dock composers",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch()
    try {
      for (const inDock of [false, true]) {
        // Each presentation starts with an empty draft; remounting intentionally preserves existing text.
        const page = await open(browser)
        await page.evaluate(() => {
          window.guest = true
        })
        await page.evaluate((inDock) => replaceComposer(inDock), inDock)
        const field = page.locator("textarea")
        await field.focus()
        await field.pressSequentially("@An")
        assert.equal(await field.inputValue(), "@An")
        assert.equal(await page.evaluate(() => draft.body.value), "@An")
        await page.close()
      }
    } finally {
      await browser.close()
    }
  },
)
