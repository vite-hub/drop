import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, test, vi } from "vite-plus/test"
import { fakeBrowser } from "wxt/testing/fake-browser"

interface Registered {
  id: string
  matches: string[]
  js: string[]
  runAt: string
  persistAcrossSessions: boolean
}

let registry: Map<string, Registered>
let granted: Set<string>
let injected: number[]

beforeEach(() => {
  registry = new Map()
  granted = new Set()
  injected = []
  Object.assign(fakeBrowser.scripting, {
    getRegisteredContentScripts: vi.fn(async ({ ids }: { ids: string[] }) =>
      ids.flatMap((id) => (registry.has(id) ? [registry.get(id)] : [])),
    ),
    registerContentScripts: vi.fn(async (scripts: Registered[]) => {
      for (const script of scripts) {
        if (registry.has(script.id)) throw new Error(`Duplicate script ID '${script.id}'`)
        registry.set(script.id, script)
      }
    }),
    unregisterContentScripts: vi.fn(async ({ ids }: { ids: string[] }) => {
      for (const id of ids) registry.delete(id)
    }),
    executeScript: vi.fn(async ({ target }: { target: { tabId: number } }) => {
      injected.push(target.tabId)
      return []
    }),
  })
  // SAFETY: the fake types contains() as returning void; the real API resolves to a boolean.
  vi.spyOn(fakeBrowser.permissions, "contains").mockImplementation((async ({ origins }: { origins: string[] }) =>
    origins.every((origin) => granted.has(origin))) as never)
  // SAFETY: the stub answers with the only tab field the marker reads.
  vi.spyOn(fakeBrowser.tabs, "query").mockImplementation((async ({ url }: { url: string }) =>
    url === "https://drop.example.com/*" ? [{ id: 7 }, { id: 8 }] : []) as never)
})

describe("the installed marker", () => {
  test("runs on the Drop's pages once its address is allowed, and on its open tabs at once", async () => {
    const { syncMarker, MARKER_ID, MARKER_SCRIPT } = await import("../lib/marker")
    await fakeBrowser.storage.local.set({ drop: "https://drop.example.com" })
    expect(await syncMarker()).toBeNull()
    expect(registry.size).toBe(0)

    granted.add("https://drop.example.com/*")
    expect(await syncMarker()).toBe("https://drop.example.com/*")
    expect([...registry.values()]).toEqual([
      {
        id: MARKER_ID,
        matches: ["https://drop.example.com/*"],
        js: [MARKER_SCRIPT],
        runAt: "document_start",
        persistAcrossSessions: false,
      },
    ])
    expect(injected).toEqual([7, 8])
  })

  test("follows the Drop to a new address and stops when its permission goes", async () => {
    const { syncMarker } = await import("../lib/marker")
    granted.add("https://drop.example.com/*")
    granted.add("https://drop.example.org/*")
    await fakeBrowser.storage.local.set({ drop: "https://drop.example.com" })
    await Promise.all([syncMarker(), syncMarker(), syncMarker()])
    await fakeBrowser.storage.local.set({ drop: "https://drop.example.org" })
    await syncMarker()
    expect([...registry.values()].map((script) => script.matches)).toEqual([["https://drop.example.org/*"]])
    granted.clear()
    await syncMarker()
    expect(registry.size).toBe(0)
  })

  test("the marker script sets only the version on the page and can't reach any lib code", () => {
    const source = readFileSync(new URL("../entrypoints/marker.content.ts", import.meta.url), "utf8")
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map(([, specifier]) => specifier)
    expect(imports).toEqual(["wxt/browser", "../../../shared/extension"])
    expect(source).toContain("setAttribute(EXTENSION_MARKER, browser.runtime.getManifest().version)")
    expect(source).not.toMatch(/storage|sendMessage|token/)
  })
})
