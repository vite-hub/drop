import assert from "node:assert/strict"
import { afterEach, test, vi } from "vite-plus/test"
import { computed, effectScope, nextTick, ref, shallowRef, watch } from "vue"
import { useViewerFrame } from "../../app/composables/useViewerFrame.ts"

const LINK = "k7f2q9m4x8wd"
const OTHER_LINK = "a1b2c3d4e5f6"
const RENDERED = `<figure class="drop-embed" data-drop-embed="${LINK}"></figure>`
const PRIVATE_HTML = "<!doctype html><html><body>Private source</body></html>"
let scope

afterEach(() => {
  scope?.stop()
  vi.unstubAllGlobals()
})

function viewer(kind, fetch = async () => ({ kind: "html", content: PRIVATE_HTML })) {
  const drop = ref({ id: "doc", kind, content: "", html: RENDERED })
  const sent = []
  const request = vi.fn(fetch)
  let receive
  for (const [name, value] of Object.entries({
    computed,
    ref,
    shallowRef,
    watch,
    onMounted: () => {},
    useCopy: () => ({ copy: () => {} }),
    useColorMode: () => ref("dark"),
    useMounted: () => ref(true),
    useBase64: () => ({ base64: ref("") }),
    useAttachmentData: () => ({ ready: ref(true), deferred: ref(false), inline: (html) => html }),
    useDebounceFn: (fn) => fn,
    useViewerQuiz: () => ({ receive: () => {} }),
    useDropFrame: (_frame, _origin, handler) => {
      receive = handler
      return { ready: ref(false), send: (message) => sent.push(message) }
    },
    // The browser parses the trusted rendered HTML in an inert template, never the frame's requested links.
    document: {
      createElement: (tag) => {
        assert.equal(tag, "template")
        const template = {
          innerHTML: "",
          content: {
            querySelectorAll: (selector) => {
              assert.equal(selector, "figure.drop-embed[data-drop-embed]")
              assert.equal(template.innerHTML, drop.value.html)
              return template.innerHTML === RENDERED ? [{ getAttribute: () => LINK }] : []
            },
          },
        }
        return template
      },
    },
    $fetch: request,
  }))
    vi.stubGlobal(name, value)
  scope = effectScope()
  scope.run(() =>
    useViewerFrame({
      drop,
      frame: ref(null),
      app: { files: ref({ "index.html": PRIVATE_HTML }), pages: ref(["index.html"]), page: ref("index.html") },
      pinned: ref([]),
      inset: ref(0),
      bottom: ref(0),
      width: ref("readable"),
      annotations: {
        frameTool: ref("browse"),
        penStyle: ref({}),
        overlays: {},
        draftingArea: ref(null),
        popover: ref(null),
      },
    }),
  )
  return { drop, sent, request, receive }
}

for (const kind of ["html", "app"])
  test(`${kind} frames cannot fetch another drop's source or title through the embed bridge`, async () => {
    const { receive, request, sent } = viewer(kind)
    receive({ type: "embeds", links: [LINK, OTHER_LINK] })
    await nextTick()
    assert.equal(request.mock.calls.length, 0)
    assert.deepEqual(sent, [])
  })

test("Markdown frames may fetch only links in their server-rendered embed boxes", async () => {
  const { receive, request, sent } = viewer("markdown")
  receive({ type: "embeds", links: [OTHER_LINK, LINK] })
  await vi.waitFor(() => assert.equal(sent.length, 1))
  assert.deepEqual(request.mock.calls, [[`/api/drops/${LINK}`]])
  assert.equal(sent[0].type, "embed-data")
  assert.equal(sent[0].link, LINK)
  assert.ok(sent[0].html.includes("Private source"))
  assert.ok(sent[0].html.includes('classList.toggle("dark", true)'))
})

for (const result of ["non-html", "inaccessible"])
  test(`Markdown embeds keep the ${result} refusal`, async () => {
    const { receive, sent } = viewer("markdown", async () => {
      if (result === "inaccessible") throw new Error("Forbidden")
      return { kind: "markdown", title: "A doc" }
    })
    receive({ type: "embeds", links: [LINK] })
    await vi.waitFor(() => assert.equal(sent.length, 1))
    assert.equal(sent[0].type, "embed-data")
    assert.equal(sent[0].link, LINK)
    assert.equal("html" in sent[0], false)
    assert.match(sent[0].error, result === "inaccessible" ? /private, expired, or deleted/ : /isn't an HTML drop/)
  })

test("a pending embed cannot deliver its source after the viewer changes to an HTML drop", async () => {
  let finish
  const { drop, receive, request, sent } = viewer("markdown", () => new Promise((resolve) => (finish = resolve)))
  receive({ type: "embeds", links: [LINK] })
  assert.equal(request.mock.calls.length, 1)
  drop.value = { id: "attacker", kind: "html", content: PRIVATE_HTML, html: "" }
  finish({ kind: "html", content: PRIVATE_HTML })
  await nextTick()
  await nextTick()
  assert.deepEqual(sent, [])
})
