import assert from "node:assert/strict"
import { mkdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { compile } from "tailwindcss"
import { ModuleKind, transpileModule } from "typescript"
import { build } from "vite-plus"
import { test } from "vite-plus/test"
import { compileScript, compileStyle, parse } from "vue/compiler-sfc"

// The real dock, comment segment and ViteHub's CommentSend in the dark pill, driven through a Send stub
// (./stub-send.ts) that plays the server and the agent, from Send 3 through every state. DROP_SEND_SHOTS=<dir> saves a screenshot of each.
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL("../../", import.meta.url))
const shots = process.env.DROP_SEND_SHOTS
const components = new Map()
const candidates = ["grid-cols-[1fr]", "grid-cols-[0fr]", "max-sm:hidden", "text-xs", "font-medium"]
// The app's layer order: preflight in base, the parts' own styles in components, and the dock's scoped rules unlayered.
let styles = `@layer theme, base, components, utilities; @layer base { ${readFileSync(require.resolve("tailwindcss/preflight.css"), "utf8")} }`
styles += readFileSync(root + "node_modules/@vite-hub/ui/dist/styles.css", "utf8")
// styles.css @imports it into the components layer, which Vite resolves in the app.
styles += `@layer components { ${readFileSync(root + "node_modules/@vite-hub/ui/dist/comment-send.css", "utf8")} }`
for (const name of ["ViewerReviewDock", "ViewerCommentsSegment", "ViewerCommentSend", "ViewerSendFailure"]) {
  const { descriptor } = parse(readFileSync(`${root}app/components/viewer/${name}.vue`, "utf8"))
  const id = `data-v-${name}`
  let code = transpileModule(compileScript(descriptor, { id, inlineTemplate: true }).content, {
    compilerOptions: { module: ModuleKind.ESNext, verbatimModuleSyntax: false },
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
// The pill's dark surface, as main.css defines it, with Nuxt UI's palette steps it reads.
const surface = readFileSync(`${root}app/assets/css/main.css`, "utf8").match(
  /@utility surface-review \{[\s\S]*?\n\}/,
)[0]
const utilities = await compile(
  `@theme { --spacing: .25rem; --breakpoint-sm: 40rem; --container-3xl: 48rem; } ${surface} @tailwind utilities;`,
)
styles += utilities.build([...candidates, "surface-review"])
styles += `:root { --ui-color-success-400: oklch(79.2% 0.209 151.711); --ui-color-warning-400: oklch(85.2% 0.199 91.936);
  --ui-color-error-400: oklch(70.4% 0.191 22.216); --ui-text-toned: #404040; --ui-border: #e5e5e5; }
  body { margin: 0; font: 15px/1.6 system-ui, sans-serif; color: #171717; background: #fff; }
  article { max-width: 36rem; margin: 48px auto; } h1 { font-size: 26px; margin: 0 0 4px; }`

// Drop's MingCute twins of the icons the parts name (app/app.config.ts), drawn inline so the shots show them.
const mingcute = JSON.parse(readFileSync(root + "node_modules/@iconify-json/mingcute/icons.json", "utf8"))
const aliases = Object.fromEntries(
  [...readFileSync(`${root}app/app.config.ts`, "utf8").matchAll(/"lucide-([\w-]+)": "mingcute:([\w-]+)"/g)].map(
    ([, from, to]) => [`i-lucide-${from}`, to],
  ),
)
const svg = (name) => {
  const icon = aliases[name] ?? name.replace(/^i-mingcute-/, "")
  const body = mingcute.icons[icon]?.body ?? ""
  return `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">${body}</svg>`
}
const icons = Object.fromEntries(
  [
    ...Object.keys(aliases),
    "i-lucide-x",
    "i-mingcute-chat-3-line",
    "i-mingcute-eye-line",
    "i-mingcute-close-line",
    "i-mingcute-file-line",
    "i-mingcute-list-check-line",
    "i-mingcute-alert-octagon-line",
    "i-mingcute-right-small-line",
  ].map((name) => [name, svg(name)]),
)

const entry = `
  import * as Vue from "vue"
  import * as VueUse from "@vueuse/core"
  import Dock from "ViewerReviewDock"
  import Comments from "ViewerCommentsSegment"
  import Send from "ViewerCommentSend"
  import SendFailure from "ViewerSendFailure"
  import { createStubSend } from "${root}test/viewer/stub-send.ts"
  Object.assign(window, Vue, VueUse)
  window.useHead = () => {}
  window.useRequestURL = () => new URL(location.href)
  const icons = ${JSON.stringify(icons)}
  let at = 10
  const comment = (n, authorId, fields = {}) => ({
    id: "c" + n, n, kind: "page", selector: "", quote: null, suggestion: null, body: "Comment " + n, authorId,
    authorName: authorId, authorImage: null, agent: null, mine: authorId === "ada", version: 1, resolved: false,
    resolvedAt: null, createdAt: at++, editedAt: null, attachments: [], replies: [], ...fields,
  })
  // Ada reads the drop: two threads are hers, one is Bob's, and one an agent answered last.
  const comments = Vue.ref([
    comment(1, "ada"),
    comment(2, "bob"),
    comment(3, "ada"),
    comment(4, "bob", { replies: [{ id: "r1", body: "Done", authorId: "ada", agent: { name: "Claude", image: null }, createdAt: at++, mine: true, attachments: [] }] }),
  ])
  const send = createStubSend({ me: "ada", comments: () => comments.value })
  window.drop = {
    send: send.controls,
    comment: (authorId) => (comments.value = [...comments.value, comment(comments.value.length + 1, authorId)]),
  }
  const button = (label, props = {}) => Vue.h("button", { style: { width: "56px" }, ...props }, label)
  const app = Vue.createApp({
    setup: () => () => Vue.h(Dock, { open: false, heading: "none", overlay: true }, {
      toolbar: () => [
        button("Drop"),
        Vue.h(Comments, { on: false, count: 5, listOpen: false, canComment: true, canUseMode: true, pins: true, pinsShown: true }, {
          tools: () => Vue.h(Send, { drop: "abc", comments: comments.value, send, prompt: "Address the comments on drop abc." }),
        }),
        button("Share"),
        button("+", { "aria-label": "More" }),
      ],
    }),
  })
  const passthrough = { setup: (_, { slots }) => () => slots.default?.() }
  app.component("UTooltip", passthrough)
  app.component("UIcon", { props: ["name"], setup: (props) => () => Vue.h("span", { class: "iconify", style: "display:inline-flex", innerHTML: icons[props.name] ?? "" }) })
  // Nuxt UI's button and modal as plain elements, so the dialog's words and actions are what the test reads.
  app.component("UButton", {
    props: ["label", "icon", "trailingIcon", "loading", "to", "color", "variant", "size"],
    setup: (props, { slots }) => () => Vue.h(props.to ? "a" : "button", { href: props.to, type: props.to ? undefined : "button", disabled: props.loading || undefined, "data-color": props.color, "data-variant": props.variant },
      [props.icon ? Vue.h("span", { class: "iconify", style: "display:inline-flex", innerHTML: icons[props.icon] ?? "" }) : null, slots.default?.() ?? props.label]),
  })
  app.component("DropCopyButton", {
    inheritAttrs: false,
    props: ["value"],
    emits: ["copy"],
    setup: (props, { slots, attrs, emit }) => () => Vue.h("button", { type: "button", "data-variant": attrs.variant, onClick: async () => {
      try {
        await navigator.clipboard.writeText(typeof props.value === "function" ? await props.value() : props.value)
        emit("copy")
      } catch {}
    } }, slots.default?.()),
  })
  app.component("UModal", {
    props: ["open", "title", "ui"],
    emits: ["update:open"],
    setup: (props, { slots, emit }) => () => Vue.h(Vue.Teleport, { to: "body" }, props.open
      ? Vue.h("div", { role: "dialog", "aria-label": props.title }, [
          Vue.h("h2", props.title), Vue.h("p", slots.description?.()), slots.body?.(), slots.footer?.(),
          Vue.h("button", { type: "button", onClick: () => emit("update:open", false) }, "Close"),
        ])
      : null),
  })
  app.component("ViewerSendFailure", SendFailure)
  app.mount("#app")
`
const bundle = await build({
  configFile: false,
  logLevel: "silent",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { alias: { "#shared": `${root}shared` } },
  plugins: [
    {
      name: "send-fixture",
      resolveId: (id) => (id.endsWith("fixture") ? "\0fixture" : components.has(id) ? "\0" + id : undefined),
      load: (id) => (id === "\0fixture" ? entry : components.get(id.slice(1))),
    },
  ],
  build: {
    write: false,
    lib: { entry: "\0fixture", formats: ["es"] },
    // The parts load Nuxt UI only for a component the app didn't register; this one registers each one they render.
    rollupOptions: { external: [/^@nuxt\/ui\//], output: { inlineDynamicImports: true } },
  },
})
const script = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(
  (item) => item.type === "chunk" && item.isEntry,
).code

const page = `<style>${styles}</style>
  <article><h1>Launch plan</h1><p>Open Drop Pro to the first 500 teams, and keep sign-ups working through launch week.</p>
  <p>We announce on Tuesday 24 November, open the waitlist that morning, and turn on billing a week later.</p></article>
  <div id="app"></div><script type="module" src="/fixture.js"></script>`

async function openFixture(browser, options) {
  const context = await browser.newContext(options)
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://drop.test" })
  const tab = await context.newPage()
  const errors = []
  tab.on("pageerror", (error) => errors.push(error.message))
  await tab.route("**/*", (route) =>
    route.fulfill(
      new URL(route.request().url()).pathname === "/fixture.js"
        ? { contentType: "text/javascript", body: script }
        : { contentType: "text/html", body: page },
    ),
  )
  await tab.goto("https://drop.test/")
  const segment = tab.locator('[data-slot="comment-send"]')
  const control = (name, ...args) => tab.evaluate(([name, args]) => window.drop.send[name](...args), [name, args])
  return { tab, segment, control, errors }
}

test("Send walks every In place state in the pill, one row each, through the stub", async () => {
  if (shots) mkdirSync(shots, { recursive: true })
  const browser = await chromium.launch()
  try {
    const { tab, segment, control, errors } = await openFixture(browser, {
      viewport: { width: 1280, height: 360 },
      deviceScaleFactor: 2,
    })
    const toolbar = tab.getByRole("group", { name: "Document tools" })
    const step = async (name, state) => {
      await tab.waitForSelector(`[data-slot="comment-send"][data-state="${state}"]`)
      await tab.evaluate(() =>
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
          .forEach((animation) => animation.finish()),
      )
      const rows = await toolbar.evaluate(
        (bar) =>
          new Set(
            [...bar.querySelectorAll("button, a, [data-slot=comment-send-status]")]
              .filter((el) => el.getClientRects().length)
              .map((el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2)),
          ).size,
      )
      if (shots) await toolbar.screenshot({ path: `${shots}/${name}.png` })
      assert.equal(rows, 1, `${name}: the pill keeps one row`)
    }

    // Send N counts every waiting thread, others' too, but not the one an agent answered last.
    const send = segment.getByRole("button", { name: "Send: 3 comments" })
    await send.waitFor()
    await step("idle", "idle")

    // Not connected yet: Send copies a setup prompt and waits for the agent, and Esc goes back to Send 3.
    await send.click()
    await step("connect-pairing", "pairing")
    assert.match(await tab.evaluate(() => navigator.clipboard.readText()), /one-time setup code [A-F0-9-]{7}/)
    await tab.keyboard.press("Escape")
    await segment.getByRole("button", { name: "Send: 3 comments" }).click()
    await tab.waitForSelector('[data-slot="comment-send"][data-state="pairing"]')
    await control("pair", { name: "T3 Code", logo: "t3", host: "relay.t3.codes" })
    await step("connect-allow", "confirm")
    assert.equal(await segment.getByText("relay.t3.codes wants your comments from this site").count(), 1)
    // The one action the segment inverts stays inverted under the pill's own button styles.
    assert.equal(
      await segment
        .getByRole("button", { name: "Allow and send 3" })
        .evaluate((button) => getComputedStyle(button).backgroundColor),
      "rgb(250, 250, 250)",
    )

    await control("hold")
    await segment.getByRole("button", { name: "Allow and send 3" }).click()
    await step("sending", "sending")
    await control("release")
    await step("sent", "sent")

    // The agent starts and links its thread; it finishes, and the button pops out.
    await control("work", "https://app.example.com/threads/42")
    const open = segment.getByRole("link", { name: "Open the T3 Code thread" })
    await open.waitFor()
    assert.equal(await open.getAttribute("href"), "https://app.example.com/threads/42")
    await step("working", "working")
    await control("finish")
    await tab.waitForFunction(() => document.querySelector('[data-slot="comment-send"]')?.hidden)
    if (shots) await toolbar.screenshot({ path: `${shots}/gone.png` })

    // Bob comments: Send 1 is back, and its first try isn't delivered.
    await tab.evaluate(() => window.drop.comment("bob"))
    await control("answer", { status: "failed", problem: "delivery", reason: "The receiver returned HTTP 502." })
    await segment.getByRole("button", { name: "Send: 1 comment" }).click()
    await step("failed", "failed")
    // The pill names the failure and opens a dialog with the receiver's answer.
    const why = tab.getByRole("dialog", { name: "Delivery to T3 Code not confirmed" })
    await why.waitFor()
    assert.equal(await why.getByText("The receiver returned HTTP 502.").count(), 1)
    assert.equal(await why.getByText("relay.t3.codes").count(), 1)
    await why.getByRole("button", { name: "Close" }).click()
    await segment.locator("..").getByRole("button", { name: "Not delivered: see why" }).click()
    await why.waitFor()
    // A second failure counts the tries and makes Agents the next step.
    await control("answer", { status: "failed", problem: "delivery", reason: "The receiver returned HTTP 502." })
    await why.getByRole("button", { name: "Retry" }).click()
    await why.getByText(/^Tried 2× · last at /).waitFor()
    assert.equal(await why.getByRole("link", { name: "Open Agents" }).getAttribute("data-variant"), "solid")
    assert.equal(await toolbar.getByRole("button", { name: "Not delivered · 2×: see why" }).count(), 1)
    if (shots) await toolbar.screenshot({ path: `${shots}/failed-twice.png` })
    await why.getByRole("button", { name: "Close" }).click()
    await segment.getByRole("button", { name: "Retry: send 1 comment again" }).click()
    await step("sent-again", "sent")
    await control("work", "https://app.example.com/threads/42")

    // A comment while the agent works brings Send 1 back beside Working, and the 31st send an hour is refused.
    await tab.evaluate(() => window.drop.comment("ada"))
    await segment.getByRole("button", { name: "Send: 1 comment" }).waitFor()
    await step("working-more", "working")
    // A retry time already past would leave Limited at once, so it's an hour ahead.
    const retryAt = Date.now() + 3_600_000
    await control("answer", { status: "limited", retryAt })
    await segment.getByRole("button", { name: "Send: 1 comment" }).click()
    await step("limited", "limited")
    const at = await tab.evaluate(
      (retryAt) =>
        new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(retryAt),
      retryAt,
    )
    assert.equal(await segment.getByText(`Limit reached, try at ${at}`).count(), 1)
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
}, 60_000)

test("Send on a server without VITEHUB_WEBHOOKS_KEY stays Send, explains itself when pressed, and the fix leads back to pairing", async () => {
  const browser = await chromium.launch()
  try {
    const { tab, segment, control, errors } = await openFixture(browser, {
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
    })
    const toolbar = tab.getByRole("group", { name: "Document tools" })
    const clipboard = () => tab.evaluate(() => navigator.clipboard.readText())

    // A member can't fix the server: they ask an admin, and hand their agent the comments another way.
    await control("unset", { problem: "unset", admin: false })
    await segment.getByRole("button", { name: "Send: 3 comments" }).click()
    const member = tab.getByRole("dialog", { name: "Send isn't set up on this Drop" })
    await member.waitFor()
    await member.getByRole("button", { name: "Copy note for admin" }).click()
    assert.match(await clipboard(), /drop\.test.*VITEHUB_WEBHOOKS_KEY/s)
    await member.getByRole("button", { name: "Copy prompt" }).click()
    assert.equal(await clipboard(), "Address the comments on drop abc.")
    await member.getByRole("button", { name: "Close" }).click()
    assert.equal(await toolbar.getByText(/needs setup|Not delivered|Retry/).filter({ visible: true }).count(), 0)
    if (shots) await toolbar.screenshot({ path: `${shots}/setup-send.png` })

    // An admin copies a prompt that fixes the host, retries, and pairs once the key is set.
    await control("unset", { problem: "unset", admin: true })
    await segment.getByRole("button", { name: "Send: 3 comments" }).click()
    const admin = tab.getByRole("dialog", { name: "Drop can't send to agents yet" })
    await admin.waitFor()
    if (shots) await toolbar.screenshot({ path: `${shots}/needs-setup.png` })
    await tab.evaluate(() =>
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: async () => {
          throw new DOMException("Permission denied", "NotAllowedError")
        },
      }),
    )
    await admin.getByRole("button", { name: "Copy fix prompt" }).click()
    assert.equal(await admin.getByRole("button", { name: "Copy again" }).count(), 0)
    await tab.evaluate(() => Reflect.deleteProperty(navigator.clipboard, "writeText"))
    await admin.getByRole("button", { name: "Copy fix prompt" }).click()
    assert.match(
      await clipboard(),
      /^Drop at drop\.test can't send review comments to agents: the server has no VITEHUB_WEBHOOKS_KEY/,
    )
    await admin.getByRole("button", { name: "Retry" }).click()
    await admin.getByText(/^Tried 3× · last at /).waitFor()
    await control("setUp")
    await admin.getByRole("button", { name: "Retry" }).click()
    await tab.waitForSelector('[data-slot="comment-send"][data-state="pairing"]')
    await admin.waitFor({ state: "detached" })
    assert.match(await clipboard(), /one-time setup code [A-F0-9-]{7}/)
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
}, 30_000)

test.each([320, 390])(
  "pairing instructions and touch targets fit the marked dock at %ipx",
  async (width) => {
    const browser = await chromium.launch()
    try {
      const { tab, segment, control, errors } = await openFixture(browser, {
        viewport: { width, height: 640 },
        hasTouch: true,
        reducedMotion: "reduce",
      })
      await tab.evaluate(() => {
        const mark = document.createElement("vitehub-tools-off")
        mark.setAttribute("edge", "bottom")
        document.documentElement.append(mark)
      })
      const assertReachable = async (locator, label) => {
        await locator.waitFor()
        const fits = await locator.evaluate((element) => {
          const dock = element.closest('[aria-label="Document tools"]').getBoundingClientRect()
          const box = element.getBoundingClientRect()
          const inside = ({ left, top, right, bottom }) =>
            left >= Math.max(0, dock.left) &&
            right <= Math.min(innerWidth, dock.right) &&
            top >= 0 &&
            bottom <= innerHeight
          if (element instanceof HTMLButtonElement)
            return (
              inside(box) && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
            )
          const text = document.createRange()
          text.selectNodeContents(element)
          return inside(box) && [...text.getClientRects()].every(inside)
        })
        assert.equal(fits, true, `${label} fits inside the dock and viewport`)
      }

      const send = segment.getByRole("button", { name: "Send: 3 comments" })
      const message = segment.locator('[data-slot="comment-send-message"]')
      await send.tap()
      await assertReachable(message, "Setup prompt instructions")
      const cancel = segment.getByRole("button", { name: "Cancel connect" })
      await assertReachable(cancel, "Cancel pairing")
      await cancel.tap()

      await send.tap()
      await cancel.waitFor()
      await tab.evaluate(() => window.drop.comment("bob"))
      await control("pair", { name: "T3 Code", logo: "t3", host: "relay.t3.codes" })
      const allow = segment.getByRole("button", { name: "Allow and send 4" })
      await allow.waitFor({ timeout: 4000 })
      await assertReachable(message, "Agent confirmation instructions")
      await assertReachable(segment.getByRole("button", { name: "Don't allow" }), "Cancel confirmation")
      await assertReachable(allow, "Allow and send 4")
      await allow.tap()
      await tab.waitForSelector('[data-slot="comment-send"][data-state="sent"]')
      await control("finish")
      await tab.waitForFunction(() => document.querySelector('[data-slot="comment-send"]')?.hidden)
      assert.deepEqual(errors, [])
    } finally {
      await browser.close()
    }
  },
  15_000,
)
