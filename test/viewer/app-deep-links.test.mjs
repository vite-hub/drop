import assert from "node:assert/strict"
import { test, vi } from "vite-plus/test"
import { computed, effectScope, nextTick, reactive, ref, shallowRef, watch } from "vue"
import { createMemoryHistory, createRouter } from "vue-router"
import { appPages } from "../../app/utils/viewer.ts"
import { textValue } from "../../shared/utils/text.ts"
import { useAppFiles } from "../../app/composables/useAppFiles.ts"
import { useSetQuery } from "../../app/composables/useSetQuery.ts"
import { useViewerFrame } from "../../app/composables/useViewerFrame.ts"

const ORIGIN = "https://abc-drop.drop.test"
const page = (body) => `<!doctype html><html><head></head><body>${body}</body></html>`

/**
 * A viewer on an app drop opened at `query` (a drop link's own query) and `hash`, with the route the viewer writes
 * back to and the messages it sends its frame.
 */
function openApp(query, { hash = "", files: given, router } = {}) {
  const files = given ?? {
    "index.html": page("Home"),
    "integrations/components.html": page("Components"),
    "workflow/cli/extract.html": page("Extract"),
    "404.html": page("Missing"),
  }
  const route = router
    ? reactive({
        get path() {
          return router.currentRoute.value.path
        },
        get query() {
          return router.currentRoute.value.query
        },
        get hash() {
          return router.currentRoute.value.hash
        },
      })
    : reactive({ query: { ...query }, hash })
  const sent = []
  const navigations = []
  let receive
  for (const [name, value] of Object.entries({
    computed,
    ref,
    shallowRef,
    watch,
    appPages,
    textValue,
    useRoute: () => route,
    useRouter: () => router,
    navigateTo: (to, { replace }) => {
      const navigation = replace ? router.replace(to) : router.push(to)
      navigations.push(navigation)
      return navigation
    },
    // As the router does: the query lands a moment later.
    useSetQuery: router
      ? useSetQuery
      : () =>
          async (patch, { hash } = {}) => {
            await Promise.resolve()
            if (hash !== undefined) route.hash = hash
            const next = { ...route.query, ...patch }
            for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key]
            route.query = next
          },
    onMounted: () => {},
    useCopy: () => ({ copy: () => {} }),
    useColorMode: () => ref("light"),
    useMounted: () => ref(true),
    useBase64: () => ({ base64: ref("") }),
    useAttachmentData: () => ({}),
    useDebounceFn: (fn) => fn,
    useEventListener: () => {},
    useViewerQuiz: () => ({ receive: () => {} }),
    useDropFrame: (_frame, _origin, handler) => {
      receive = handler
      return { ready: ref(false), send: (message) => sent.push(message) }
    },
  }))
    vi.stubGlobal(name, value)
  const scope = effectScope()
  const drop = ref({ id: "d1", kind: "app", files, contentOrigin: ORIGIN, contentGrant: "grant" })
  const app = scope.run(() => useAppFiles(drop))
  const viewer = scope.run(() =>
    useViewerFrame({
      drop,
      frame: ref(null),
      app,
      pinned: ref([]),
      inset: ref(0),
      bottom: ref(0),
      width: ref("readable"),
      annotations: { frameTool: ref("browse"), overlays: {}, draftingArea: ref(null), popover: ref(null) },
    }),
  )
  const settle = async () => {
    for (let i = 0; i < 5; i++) await nextTick()
  }
  const stop = () => {
    scope.stop()
    vi.unstubAllGlobals()
  }
  return { app, viewer, route, sent, navigations, receive: (message) => receive(message), settle, stop }
}

async function appRouter(query = {}, hash = "") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/drops/:id", component: {} }],
  })
  await router.push({ path: "/drops/d1", query, hash })
  return router
}

test("a drop link's ?path= opens the app's frame at that address, query and hash included", async () => {
  const { app, viewer, sent, receive, stop } = openApp({ path: "/integrations/components?tab=vue#props" })
  try {
    assert.equal(viewer.frameSrc.value, `${ORIGIN}/integrations/components?tab=vue#props`)
    assert.equal(app.page.value, "integrations/components.html")
    receive({ type: "host", path: "/integrations/components?tab=vue#props" })
    assert.ok(sent.at(-1).html.includes("Components"))
  } finally {
    stop()
  }
})

test("a hand-written link's hash after the query belongs to the app's address, and goes once the app moves", async () => {
  const { viewer, route, receive, settle, stop } = openApp({ path: "/workflow/cli/extract" }, { hash: "#usage" })
  try {
    assert.equal(viewer.frameSrc.value, `${ORIGIN}/workflow/cli/extract#usage`)
    receive({ type: "host", path: "/workflow/cli/extract#usage" })
    receive({ type: "location", path: "/integrations/components" })
    await settle()
    assert.equal(route.query.path, "/integrations/components")
    assert.equal(route.hash, "", "the old page's hash would land on the new page")
  } finally {
    stop()
  }
})

test("changing only the drop link's hash moves the app to the new anchor", async () => {
  const { app, viewer, route, receive, settle, stop } = openApp(
    { path: "/integrations/components" },
    { hash: "#props" },
  )
  try {
    receive({ type: "host", path: "/integrations/components#props" })
    route.hash = "#usage"
    await settle()
    assert.equal(app.location.value, "/integrations/components#usage")
    assert.equal(viewer.frameSrc.value, `${ORIGIN}/integrations/components#usage`)
  } finally {
    stop()
  }
})

test("a canceled address write does not suppress a later link to that address", async () => {
  const router = await appRouter()
  const { app, viewer, receive, navigations, settle, stop } = openApp({}, { router })
  const paused = Promise.withResolvers()
  const started = Promise.withResolvers()
  let pause = true
  router.beforeEach((to) => {
    if (pause && to.query.path === "/integrations/components") {
      pause = false
      started.resolve()
      return paused.promise
    }
  })
  try {
    receive({ type: "host", path: "/" })
    receive({ type: "location", path: "/integrations/components" })
    await started.promise
    receive({ type: "location", path: "/workflow/cli/extract" })
    await settle()
    await navigations.at(-1)
    paused.resolve()
    await navigations[0]
    await router.push({ query: { path: "/integrations/components" } })
    await settle()
    assert.equal(app.location.value, "/integrations/components")
    assert.equal(viewer.frameSrc.value, `${ORIGIN}/integrations/components`)
  } finally {
    paused.resolve()
    stop()
  }
})

test("an overlapping query update preserves the app's pending removal of the outer hash", async () => {
  const router = await appRouter({ path: "/integrations/components" }, "#props")
  const { route, stop } = openApp({}, { router })
  try {
    const setQuery = useSetQuery()
    await Promise.all([setQuery({ path: "/workflow/cli/extract" }, { hash: "" }), setQuery({ comment: 3 })])
    assert.equal(route.hash, "")
    assert.equal(route.query.path, "/workflow/cli/extract")
    assert.equal(route.query.comment, "3")
  } finally {
    stop()
  }
})

test("an address the app doesn't have shows its 404.html, and a single-page app its index.html", () => {
  const missing = openApp({ path: "/nope" })
  try {
    assert.equal(missing.viewer.frameSrc.value, `${ORIGIN}/nope`)
    missing.receive({ type: "host", path: "/nope" })
    assert.ok(missing.sent.at(-1).html.includes("Missing"))
  } finally {
    missing.stop()
  }
  const spa = openApp({ path: "/settings/profile" }, { files: { "index.html": page("Shell") } })
  try {
    spa.receive({ type: "host", path: "/settings/profile" })
    assert.ok(spa.sent.at(-1).html.includes("Shell"))
    assert.equal(spa.viewer.frameSrc.value, `${ORIGIN}/settings/profile`)
  } finally {
    spa.stop()
  }
})

test("a link that tries to leave the app's origin opens the app at its start", () => {
  const { viewer, stop } = openApp({ path: "//evil.example/x" })
  try {
    assert.equal(viewer.frameSrc.value, `${ORIGIN}/`)
  } finally {
    stop()
  }
})

test("navigating inside the app keeps the drop link's ?path= in step, without reloading the frame", async () => {
  const { app, viewer, route, receive, settle, stop } = openApp({})
  try {
    receive({ type: "host", path: "/" })
    const key = viewer.frameKey.value
    receive({ type: "location", path: "/integrations/components" })
    receive({ type: "location", path: "/integrations/components#props" })
    await settle()
    assert.equal(route.query.path, "/integrations/components#props")
    assert.equal(app.page.value, "integrations/components.html")
    assert.equal(viewer.frameKey.value, key, "the frame went there itself")
    receive({ type: "location", path: "/" })
    await settle()
    assert.equal(route.query.path, undefined, "the app's start needs no ?path=")
    assert.equal(viewer.frameKey.value, key)
  } finally {
    stop()
  }
})

test("a new ?path= from outside the frame, or a comment's page, moves the frame there", async () => {
  const { app, viewer, route, receive, settle, stop } = openApp({})
  try {
    receive({ type: "host", path: "/" })
    route.query = { path: "/workflow/cli/extract" }
    await settle()
    assert.equal(viewer.frameSrc.value, `${ORIGIN}/workflow/cli/extract`)
    receive({ type: "host", path: "/workflow/cli/extract" })
    const key = viewer.frameKey.value
    app.page.value = "integrations/components.html"
    await settle()
    assert.equal(viewer.frameSrc.value, `${ORIGIN}/integrations/components`)
    assert.equal(viewer.frameKey.value, key + 1)
    assert.equal(route.query.path, "/integrations/components")
  } finally {
    stop()
  }
})

test("an older link's ?file= still opens its page, and leaves for ?path= once the app moves", async () => {
  const { viewer, route, receive, settle, stop } = openApp({ file: "integrations/components.html", v: "2" })
  try {
    assert.equal(viewer.frameSrc.value, `${ORIGIN}/integrations/components`)
    receive({ type: "location", path: "/workflow/cli/extract" })
    await settle()
    assert.deepEqual({ ...route.query }, { path: "/workflow/cli/extract", v: "2" })
  } finally {
    stop()
  }
})
