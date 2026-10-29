import assert from "node:assert/strict"
import { test, vi } from "vite-plus/test"
import { computed, effectScope, ref, shallowRef, watch } from "vue"
import { useViewerFrame } from "../../app/composables/useViewerFrame.ts"

test("content-origin app frames keep their own picker unless they are the viewer's direct document", () => {
  const files = ref({
    "index.html": "<!doctype html><html><head></head><body>Home</body></html>",
    "nested.html": "<!doctype html><html><head></head><body>Nested</body></html>",
    "404.html": "<!doctype html><html><head></head><body>Missing</body></html>",
  })
  const sent = []
  let receive
  for (const [name, value] of Object.entries({
    computed,
    ref,
    shallowRef,
    watch,
    onMounted: () => {},
    useCopy: () => ({ copy: () => {} }),
    useColorMode: () => ref("light"),
    useMounted: () => ref(true),
    useBase64: () => ({ base64: ref("") }),
    useAttachmentData: () => ({}),
    useDebounceFn: (fn) => fn,
    useViewerQuiz: () => ({ receive: () => {} }),
    useDropFrame: (_frame, _origin, handler) => {
      receive = handler
      return { ready: ref(false), send: (message) => sent.push(message) }
    },
  }))
    vi.stubGlobal(name, value)
  const scope = effectScope()
  try {
    const viewer = scope.run(() =>
      useViewerFrame({
        drop: ref({ kind: "app", contentOrigin: "https://app.drop.test", contentGrant: "grant" }),
        frame: ref(null),
        app: { files, pages: computed(() => Object.keys(files.value)), page: ref("index.html") },
        pinned: ref([]),
        inset: ref(0),
        bottom: ref(0),
        width: ref("readable"),
        annotations: { frameTool: ref("browse"), overlays: {}, draftingArea: ref(null), popover: ref(null) },
        variantBar: true,
      }),
    )
    const lastDocument = () => sent.at(-1).html
    const hosted = (html) => html.includes("self.__dropVariantBar = true;")
    assert.ok(hosted(viewer.srcdoc.value))
    receive({ type: "host", path: "/nested.html" })
    assert.ok(lastDocument().includes("Nested"))
    assert.ok(hosted(lastDocument()), "navigation in the direct frame uses Drop's bar")
    receive({ type: "host", path: "/unknown" })
    assert.ok(lastDocument().includes("Missing"))
    assert.ok(hosted(lastDocument()), "a direct fallback also uses Drop's bar")
    receive({ type: "frame-request", id: "nested", path: "/nested.html" })
    assert.ok(lastDocument().includes("Nested"))
    assert.equal(sent.at(-1).id, "nested")
    assert.equal(hosted(lastDocument()), false, "nested frames keep their own controls")
    receive({ type: "frame-request", id: "missing", path: "/unknown" })
    assert.ok(lastDocument().includes("Missing"))
    assert.equal(hosted(lastDocument()), false, "nested fallback documents keep their own controls")
    delete files.value["404.html"]
    receive({ type: "frame-request", id: "spa", path: "/unknown" })
    assert.ok(lastDocument().includes("Home"))
    assert.equal(hosted(lastDocument()), false, "nested SPA fallback documents keep their own controls")
  } finally {
    scope.stop()
    vi.unstubAllGlobals()
  }
})
