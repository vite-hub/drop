import assert from "node:assert/strict"
import { $fetch as ofetch } from "ofetch"
import { afterEach, test } from "vite-plus/test"

// Load the real Nuxt plugin with only Nuxt's registration helper supplied.
globalThis.defineNuxtPlugin = (plugin) => plugin
const { default: plugin } = await import("../../app/plugins/signed-out.client.ts")
delete globalThis.defineNuxtPlugin

let useFetch
globalThis.createUseFetch =
  () =>
  (...args) =>
    useFetch(...args)
const { useMe } = await import("../../app/composables/useApi.ts")
delete globalThis.createUseFetch

const origin = "https://drop.example.com"
const saved = {}
const stub = (name, value) => {
  if (!(name in saved)) saved[name] = globalThis[name]
  globalThis[name] = value
}
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) globalThis[name] = value
  for (const name of Object.keys(saved)) delete saved[name]
})

/** Runs the plugin on a page whose server answers each path in `routes` with a status, or with JSON for /api/me. */
function page(routes, { signedIn = true } = {}) {
  // Like Nuxt's useNuxtData: the fetched value, else the one hydrated from the server payload.
  const state = { async: null, payload: signedIn ? { id: "member" } : null }
  const me = {
    get value() {
      return state.async ?? state.payload
    },
    set value(value) {
      state.async = value
    },
  }
  const toasts = []
  const navigations = []
  let meCalls = 0
  stub("location", new URL("/drops", origin))
  stub("keys", { me: "me" })
  stub("useNuxtData", () => ({ data: me }))
  stub("clearNuxtData", () => {
    state.async = null
    state.payload = null
  })
  stub("useToast", () => ({ add: (toast) => toasts.push(toast) }))
  stub("useRouter", () => ({ currentRoute: { value: { fullPath: "/d/abc?v=2" } } }))
  stub("navigateTo", (to) => navigations.push(to))
  stub("fetch", async (request) => {
    const { pathname } = new URL(request instanceof Request ? request.url : request, origin)
    const answer = pathname in routes ? routes[pathname]() : 404
    if (pathname === "/api/me") meCalls++
    if (typeof answer === "number") return new Response(null, { status: answer })
    // /api/me answers nobody with an empty text 200, which ofetch reads as "".
    if (answer === null) return new Response("")
    return Response.json(answer)
  })
  // Nuxt 5's client $fetch is this same instance, created at import and calling globalThis.fetch per request.
  stub("$fetch", ofetch.create({ baseURL: origin }))
  useFetch = async (path, { transform }) => {
    const result = await $fetch(path)
    state.async = state.payload = transform ? await transform(result) : result
    return { data: me }
  }
  plugin()
  return { me, toasts, navigations, meCalls: () => meCalls }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

test("a 401 after the session ends offers sign-in once, back to the same page", async () => {
  const view = page({ "/api/drops/abc/pin": () => 401, "/api/me": () => null })
  await Promise.all([
    $fetch("/api/drops/abc/pin", { method: "PUT" }).catch(() => {}),
    $fetch("/api/drops/abc/pin", { method: "PUT" }).catch(() => {}),
  ])
  await settle()
  assert.equal(view.meCalls(), 1)
  assert.equal(view.me.value, null)
  assert.equal(view.toasts.length, 1)
  assert.equal(view.toasts[0].title, "You're signed out")
  view.toasts[0].actions[0].onClick()
  assert.deepEqual(view.navigations, [{ path: "/signin", query: { redirect: "/d/abc?v=2" } }])
  const guest = await useMe()
  assert.equal(guest.data.value, null)
  assert.equal(guest.data.value?.expiry.days ?? 0, 0)
  assert.equal(view.meCalls(), 2)
  await $fetch("/api/drops/abc/pin", { method: "PUT" }).catch(() => {})
  await settle()
  assert.equal(view.meCalls(), 2)
  assert.equal(view.toasts.length, 1)
})

test("a 401 while still signed in, from another origin, or while /api/me fails, shows nothing", async () => {
  let me = () => ({ id: "member" })
  const view = page({ "/api/drops/abc": () => 401, "/api/me": () => me() })
  await $fetch("/api/drops/abc").catch(() => {})
  await settle()
  assert.equal(view.meCalls(), 1)
  await fetch("https://other.example.com/api/drops/abc")
  await settle()
  assert.equal(view.meCalls(), 1)
  me = () => 503
  await $fetch("/api/drops/abc").catch(() => {})
  await settle()
  // ofetch retries the 503, so /api/me is asked more than once.
  assert.ok(view.meCalls() > 1)
  assert.deepEqual(view.me.value, { id: "member" })
  assert.equal(view.toasts.length, 0)
})

test("a signed-out visitor's 401 shows nothing", async () => {
  const view = page({ "/api/drops/abc": () => 401, "/api/me": () => null }, { signedIn: false })
  await $fetch("/api/drops/abc").catch(() => {})
  await settle()
  assert.equal(view.meCalls(), 0)
  assert.equal(view.toasts.length, 0)
})
