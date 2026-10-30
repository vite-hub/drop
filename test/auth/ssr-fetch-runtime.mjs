import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire, stripTypeScriptTypes } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { SourceTextModule, SyntheticModule } from "node:vm"
import * as vue from "vue"
import * as valibot from "valibot"
import * as ofetch from "ofetch"

// Execute this project's composable against the installed Nuxt fetch/async-data runtime. Only Nuxt's request
// context and HTTP transport are supplied here; its caching, deduplication, cancellation, and refresh code are real.
const root = fileURLToPath(new URL("../../", import.meta.url))
const nuxt = dirname(fileURLToPath(import.meta.resolve("nuxt/package.json")))
const nuxtRequire = createRequire(import.meta.resolve("nuxt/package.json"))
let app
let calls
const pageEvent = { context: {} }
let answer
const reset = (value) => {
  app = {
    payload: { data: {}, _errors: {}, serverRendered: true },
    static: { data: {} },
    _asyncData: vue.shallowReactive({}),
    _asyncDataPromises: {},
    isHydrating: false,
    hook: () => () => {},
    runWithContext: (fn) => fn(),
  }
  calls = 0
  answer = value
}
const modules = new Map()
const synthetic = (id, exports) => {
  if (!modules.has(id))
    modules.set(
      id,
      new SyntheticModule(
        Object.keys(exports),
        function () {
          for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
        },
        { identifier: id },
      ),
    )
  return modules.get(id)
}
const defaults = {
  asyncDataDefaults: { deep: false },
  granularCachedData: true,
  pendingWhenIdle: false,
  purgeCachedData: true,
  stripNeverHydratedData: false,
  tracingChannelNuxt: false,
  alwaysRunFetchOnKeyChange: false,
  fetchDefaults: {},
  vapor: false,
}
const stubs = {
  vue,
  valibot,
  ofetch,
  "@vue/shared": { isPlainObject: (value) => Object.prototype.toString.call(value) === "[object Object]" },
  "#build/nuxt.config.mjs": defaults,
  "#build/fetch": { $fetch: () => assert.fail("useApi must use its request-local transport") },
  "#shared/quotas": { QuotaFailureSchema: valibot.unknown() },
  "./ssr.js": { useRequestFetch: () => assert.fail("useApi must use its request-local transport") },
  "../diagnostics/core.js": { appDiagnostics: {} },
  "../nuxt.js": { useNuxtApp: () => app },
  "../internal/tracing.js": { traceAsync: () => assert.fail("tracing is off") },
  "../utils.js": { getUserCaller: () => undefined, toArray: (value) => (Array.isArray(value) ? value : [value]) },
  "./error.js": { createError: (error) => error },
  "../utils/hash.js": { hashFunction: String, hashKey: JSON.stringify },
  "../components/client-only.js": { clientOnlySymbol: Symbol() },
  "./ready.js": { onNuxtReady: () => assert.fail("SSR must not wait for client readiness") },
  "../diagnostics/data.js": { dataDiagnostics: {} },
  "../../app/diagnostics/core.js": { appDiagnostics: {} },
  "./lazy-hydration.js": { neverHydratedSymbol: Symbol() },
  nitro: {
    serverFetch: async (request, options, context) => {
      assert.equal(new URL(request).origin, "https://drop.example")
      assert.equal(new Headers(options.headers).get("cookie"), "fixture-session")
      // The page's request goes along, so the API call takes its identity (server/utils/identity.ts).
      assert.equal(context?.dropPage, pageEvent)
      calls++
      await new Promise(setImmediate)
      return Response.json(answer)
    },
  },
}
async function load(path, isApp = false) {
  if (modules.has(path)) return modules.get(path)
  let source = readFileSync(path, "utf8")
  if (isApp) {
    source = stripTypeScriptTypes(source).replaceAll("createUseFetch(", "createUseFetch.__nuxt_factory(")
    source = 'import { createUseFetch, useRequestURL, useRequestHeaders, useRequestEvent, keys } from "#test/context";\n' + source
  }
  source = source
    .replaceAll("import.meta.server", "true")
    .replaceAll("import.meta.client", "false")
    .replaceAll("import.meta.dev", "false")
    .replaceAll("import.meta.prerender", "false")
  const module = new SourceTextModule(source, {
    identifier: path,
    importModuleDynamically: async (id) => {
      const dependency = synthetic(id, stubs[id])
      if (dependency.status === "unlinked") await dependency.link(() => assert.fail("synthetic import"))
      if (dependency.status === "linked") await dependency.evaluate()
      return dependency
    },
  })
  modules.set(path, module)
  return module
}
async function link(id, parent) {
  if (id in stubs) return synthetic(id, stubs[id])
  if (!id.startsWith(".")) return synthetic(id, await import(nuxtRequire.resolve(id)))
  return load(resolve(dirname(parent.identifier), id))
}
const fetchModule = await load(resolve(nuxt, "dist/app/composables/fetch.js"))
await fetchModule.link(link)
await fetchModule.evaluate()
stubs["#test/context"] = {
  createUseFetch: fetchModule.namespace.createUseFetch,
  useRequestURL: () => new URL("https://drop.example/d/fixture"),
  useRequestHeaders: () => ({ cookie: "fixture-session" }),
  useRequestEvent: () => pageEvent,
  keys: { me: "me" },
}
const source = process.env.DROP_SSR_SOURCE || resolve(root, "app/composables/useApi.ts")
const apiModule = await load(source, true)
await apiModule.link(link)
await apiModule.evaluate()
const { useMe, useApi } = apiModule.namespace

// Production recorded 94 /api/me calls in one render. Middleware finishes before the layout/page,
// then sidebar rows and viewer children subscribe to the same key.
for (const value of [{ id: "owner" }, null]) {
  reset(value)
  await useMe()
  await useMe()
  await Promise.all(Array.from({ length: 92 }, () => useMe()))
  assert.deepEqual(app.payload.data.me, value)
  console.log(`SSR bootstrap ${value ? "signed in" : "signed out"}: ${calls} HTTP calls`)
  assert.equal(calls, 1, "middleware, page, and sidebar consumers must share the SSR bootstrap")
}

reset({ id: "next-user" })
const me = await useMe()
assert.deepEqual(me.data.value, { id: "next-user" }, "SSR cache must never cross requests")
answer = { id: "refreshed-user" }
await me.refresh()
assert.equal(calls, 2, "an explicit refresh must bypass initial SSR data")
assert.deepEqual(me.data.value, answer)

reset([])
await Promise.all([useApi("/api/drops", { key: "drops" }), useApi("/api/drops", { key: "drops" })])
assert.equal(calls, 1, "concurrent consumers must not cancel and restart the same request")
await useApi("/api/drops", { key: "shared-with-me", query: { shared: 1 } })
assert.equal(calls, 2, "distinct data keys must stay independent")

reset({ id: "owner" })
await Promise.all([
  useApi("/api/me", { key: "me", dedupe: "cancel" }),
  useApi("/api/me", { key: "me", dedupe: "cancel" }),
])
assert.equal(calls, 2, "a caller's cancellation policy must still take precedence")

reset({ id: "owner" })
await useApi("/api/me", { key: "me", getCachedData: () => ({ id: "custom" }) })
assert.equal(calls, 0, "a caller's cache policy must still take precedence")
assert.deepEqual(app.payload.data.me, { id: "custom" })
console.log("request isolation, explicit refresh, concurrent consumers, and distinct keys: passed")
