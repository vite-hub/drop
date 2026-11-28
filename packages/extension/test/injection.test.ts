import { beforeEach, describe, expect, test, vi } from "vite-plus/test"
import { fakeBrowser } from "wxt/testing/fake-browser"

const policy = { drop: "https://drop.example.com", content: "https://*-drop.example.com" }
let pages: Record<number, string>
let injected: number[]
let granted: Set<number>
let allSites: boolean

beforeEach(() => {
  pages = { 1: "https://example.com/a", 2: "https://drop.example.com/d/abc", 3: "https://abc123-drop.example.com/" }
  injected = []
  granted = new Set([1, 2, 3])
  // A tab without a grant refuses scripts, as Chromium and Firefox do.
  vi.spyOn(fakeBrowser.scripting, "executeScript").mockImplementation((async (injection: {
    target: { tabId: number }
    files?: string[]
  }) => {
    const { tabId } = injection.target
    if (!granted.has(tabId)) throw new Error("Cannot access contents of the page.")
    if (injection.files) injected.push(tabId)
    return [{ frameId: 0, result: pages[tabId] }]
  }) as never)
  allSites = false
  // SAFETY: the fake types contains() as returning void; the real API resolves to a boolean.
  vi.spyOn(fakeBrowser.permissions, "contains").mockImplementation((async () => allSites) as never)
})

const notDrop = async () => new Response("<html>", { status: 200 })
const down = async () => new Response("", { status: 502 })

describe("inject", () => {
  test("mounts the review script on a site and remembers the tab", async () => {
    const { inject, openTabs, REVIEW_SCRIPT } = await import("../lib/injection")
    expect(await inject(1, policy)).toEqual({ ok: true, origin: "https://example.com" })
    expect(fakeBrowser.scripting.executeScript).toHaveBeenLastCalledWith({
      target: { tabId: 1 },
      files: [REVIEW_SCRIPT],
    })
    expect(await openTabs()).toEqual({ 1: "https://example.com" })
  })

  test("never on the Drop or its drops' content origins", async () => {
    const { inject } = await import("../lib/injection")
    expect(await inject(2, policy)).toMatchObject({ ok: false, reason: "blocked" })
    expect(await inject(3, policy)).toMatchObject({ ok: false, reason: "blocked" })
    expect(injected).toEqual([])
  })

  test("without a grant, nothing runs", async () => {
    const { inject } = await import("../lib/injection")
    granted.clear()
    expect(await inject(1, policy)).toEqual({ ok: false, reason: "no-grant" })
  })
})

describe("after a load", () => {
  const press = { hand: "press" as const, kept: [] }

  test("a tab nobody pressed gets nothing, not even a probe", async () => {
    const { onTabLoaded } = await import("../lib/injection")
    expect(await onTabLoaded(1, { url: "https://example.com/a" }, policy, press)).toBeUndefined()
    expect(await onTabLoaded(1, {}, policy, press)).toBeUndefined()
    expect(fakeBrowser.scripting.executeScript).not.toHaveBeenCalled()
  })

  test("an open pill comes back while the grant holds, and closes when it's gone", async () => {
    const { inject, onTabLoaded, openTabs } = await import("../lib/injection")
    await inject(1, policy)
    expect(await onTabLoaded(1, {}, policy, press)).toMatchObject({ ok: true })
    granted.delete(1)
    expect(await onTabLoaded(1, {}, policy, press)).toMatchObject({ ok: false, reason: "no-grant" })
    expect(await openTabs()).toEqual({})
  })

  test("a kept site matches its exact origin", async () => {
    const { onTabLoaded } = await import("../lib/injection")
    const kept = { hand: "press" as const, kept: ["https://example.com"] }
    expect(await onTabLoaded(1, { url: "http://example.com/a" }, policy, kept)).toBeUndefined()
    expect(await onTabLoaded(1, { url: "https://example.com:8443/a" }, policy, kept)).toBeUndefined()
    expect(await onTabLoaded(1, { url: "https://example.com/b" }, policy, kept)).toMatchObject({ ok: true })
  })

  test("on every page only while the permission is held", async () => {
    const { onTabLoaded } = await import("../lib/injection")
    const everywhere = { hand: "everywhere" as const, kept: [] }
    expect(await onTabLoaded(1, { url: "https://example.com/a" }, policy, everywhere)).toBeUndefined()
    allSites = true
    expect(await onTabLoaded(1, { url: "https://example.com/a" }, policy, everywhere)).toMatchObject({ ok: true })
  })
})

describe("deployment", () => {
  test("addresses and patterns", async () => {
    const { normalizeDrop, originPattern, matchesContentOrigin } = await import("../lib/deployment")
    expect(normalizeDrop("drop.example.com/some/path")).toBe("https://drop.example.com")
    expect(normalizeDrop("http://drop.example.com")).toBeUndefined()
    expect(normalizeDrop("http://localhost:3000")).toBe("http://localhost:3000")
    expect(normalizeDrop("https://user:pass@drop.example.com")).toBeUndefined()
    expect(originPattern("http://localhost:3000")).toBe("http://localhost/*")
    expect(matchesContentOrigin("https://abc-drop.example.com", "https://*-drop.example.com")).toBe(true)
    expect(matchesContentOrigin("https://a.b-drop.example.com", "https://*-drop.example.com")).toBe(false)
    expect(matchesContentOrigin("https://drop.example.com", "https://*-drop.example.com")).toBe(false)
  })

  test("the hello check says what's wrong", async () => {
    const { checkDrop } = await import("../lib/deployment")
    const { createFakeDrop } = await import("./fake-drop")
    const fake = createFakeDrop()
    expect(await checkDrop("drop.example.com", fake.fetch)).toEqual({
      ok: true,
      drop: "https://drop.example.com",
      name: "Example Drop",
      version: "0.1.0",
      content: "https://*-drop.example.com",
    })
    expect(await checkDrop("not a url", fake.fetch)).toEqual({ ok: false, error: "invalid-address" })
    expect(await checkDrop("https://elsewhere.example.com", fake.fetch)).toEqual({ ok: false, error: "unreachable" })
    expect(await checkDrop("https://example.com", notDrop)).toEqual({ ok: false, error: "not-a-drop" })
    expect(await checkDrop("https://example.com", down)).toEqual({ ok: false, error: "server-error", status: 502 })
  })
})
