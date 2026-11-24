import assert from "node:assert/strict"
import { createFetch } from "ofetch"
import { afterEach, test } from "vite-plus/test"

// Load the real Nuxt plugin with only Nuxt's registration helper supplied.
globalThis.defineNuxtPlugin = (plugin) => plugin
const { default: plugin } = await import("../../app/plugins/signed-out.client.ts")
delete globalThis.defineNuxtPlugin

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

/** Runs the plugin on a page whose server answers each path in `routes` with that status. */
async function page(routes, { signedIn = true } = {}) {
  const me = { value: signedIn ? { id: "member" } : null }
  const toasts = []
  const navigations = []
  stub("location", new URL("/drops", origin))
  stub("keys", { me: "me" })
  stub("useNuxtData", () => ({ data: me }))
  stub("useToast", () => ({ add: (toast) => toasts.push(toast) }))
  stub("useRouter", () => ({ currentRoute: { value: { fullPath: "/d/abc?v=2" } } }))
  stub("navigateTo", (to) => navigations.push(to))
  let meCalls = 0
  stub("refreshNuxtData", async () => {
    meCalls++
    me.value = routes["/api/me"]()
  })
  stub(
    "$fetch",
    createFetch({
      fetch: async (url) => {
        const { pathname } = new URL(url, origin)
        const status = routes[pathname]?.() ?? 404
        return new Response(status === 401 ? '{"statusCode":401}' : "{}", {
          status,
          headers: { "content-type": "application/json" },
        })
      },
    }),
  )
  plugin()
  return { toasts, navigations, meCalls: () => meCalls }
}

test("a 401 after the session ends offers sign-in once, back to the same page", async () => {
  const view = await page({ "/api/drops/abc": () => 401, "/api/me": () => null })
  await Promise.all([
    $fetch("/api/drops/abc", { method: "PATCH" }).catch(() => {}),
    $fetch("/api/drops/abc", { method: "PATCH" }).catch(() => {}),
  ])
  await new Promise((resolve) => setTimeout(resolve))
  assert.equal(view.meCalls(), 1)
  assert.equal(view.toasts.length, 1)
  assert.equal(view.toasts[0].title, "You're signed out")
  view.toasts[0].actions[0].onClick()
  assert.deepEqual(view.navigations, [{ path: "/signin", query: { redirect: "/d/abc?v=2" } }])
})

test("a 401 while still signed in, or from another origin, shows nothing", async () => {
  const view = await page({ "/api/drops/abc": () => 401, "/api/me": () => ({ id: "member" }) })
  await $fetch("/api/drops/abc").catch(() => {})
  await $fetch("https://other.example.com/api/drops/abc").catch(() => {})
  await new Promise((resolve) => setTimeout(resolve))
  assert.equal(view.meCalls(), 1)
  assert.equal(view.toasts.length, 0)
})

test("a signed-out visitor's 401 shows nothing", async () => {
  const view = await page({ "/api/drops/abc": () => 401, "/api/me": () => null }, { signedIn: false })
  await $fetch("/api/drops/abc").catch(() => {})
  await new Promise((resolve) => setTimeout(resolve))
  assert.equal(view.meCalls(), 0)
  assert.equal(view.toasts.length, 0)
})
