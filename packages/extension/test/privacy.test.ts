import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { createFakeDrop, DROP, linkTo, type FakeDrop } from "./fake-drop"

const PACKAGE = fileURLToPath(new URL("..", import.meta.url))
const SOURCES = ["lib", "entrypoints", "components", "assets"]
const URL_LITERAL = /https?:\/\/[a-z\d][a-z\d.-]*\.[a-z]{2,}[^\s"'`)<>\\]*/gi

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return files(path)
    return /\.(ts|vue)$/.test(entry.name) ? [path] : []
  })
}

describe("the manifest", () => {
  test("asks for no site at install in either browser, and every host is optional", async () => {
    vi.stubEnv("DROP_E2E", "")
    const { default: config } = await import("../wxt.config")
    if (typeof config.manifest !== "function") throw new Error("wxt.config.ts builds its manifest per browser.")
    for (const browser of ["chrome", "firefox"]) {
      // SAFETY: the manifest function reads only `browser` from WXT's config environment.
      const manifest = await config.manifest({ browser } as never)
      expect(manifest.host_permissions).toBeUndefined()
      expect(manifest.content_scripts).toBeUndefined()
      expect(manifest.optional_host_permissions).toEqual(["<all_urls>"])
      expect(manifest.permissions).toEqual(["activeTab", "scripting", "storage", "identity", "contextMenus"])
    }
    vi.unstubAllEnvs()
  }, 30_000)

  test("the page script is registered at run time and matches no site by itself", () => {
    const entry = readFileSync(join(PACKAGE, "entrypoints/review.content.ts"), "utf8")
    expect(entry).toMatch(/registration:\s*"runtime"/)
    expect(entry).toMatch(/matches:\s*\[\]/)
  })
})

describe("where data goes", () => {
  test("the extension's own code names no server but the default Drop", () => {
    const found = SOURCES.flatMap((dir) =>
      files(join(PACKAGE, dir)).flatMap((path) =>
        [...readFileSync(path, "utf8").matchAll(URL_LITERAL)].map(([url]) => `${relative(PACKAGE, path)}: ${url}`),
      ),
    )
    expect(found.filter((line) => !line.endsWith(": https://drop.vitehub.dev"))).toEqual([
      "entrypoints/welcome/App.vue: https://example.com/",
    ])
  })
})

describe("disconnecting", () => {
  let drop: FakeDrop

  beforeEach(() => {
    drop = createFakeDrop()
    vi.stubGlobal("fetch", drop.fetch)
  })
  afterEach(() => vi.unstubAllGlobals())

  test("forgets the sign-in in the browser and asks the Drop to revoke it", async () => {
    const link = await linkTo(drop)
    const oauth = await import("../lib/oauth")
    await oauth.unlink()
    const revoked = drop.requests.find((request) => request.url === `${DROP}/api/auth/oauth2/revoke`)
    expect(new URLSearchParams(revoked?.body).get("token")).toBe(link.refreshToken)
    const kept = JSON.stringify([
      await fakeBrowser.storage.local.get(null),
      await fakeBrowser.storage.session.get(null),
    ])
    expect(kept).not.toContain(link.refreshToken)
    expect(kept).not.toContain(link.access.token)
    await expect(oauth.accessToken()).rejects.toThrow(oauth.Unlinked)
  })
})

describe("switching Drop off", () => {
  test("gives back the site permission it no longer needs", async () => {
    await fakeBrowser.storage.local.set({ drop: DROP })
    vi.spyOn(fakeBrowser.permissions, "contains").mockImplementation((async () => true) as never)
    const removed = vi.spyOn(fakeBrowser.permissions, "remove").mockImplementation((async () => true) as never)
    vi.spyOn(fakeBrowser.contextMenus.onClicked, "addListener").mockImplementation(() => undefined)
    vi.spyOn(fakeBrowser.commands.onCommand, "addListener").mockImplementation(() => undefined)
    const { startBackground } = await import("../lib/background")
    startBackground()
    const page = { id: "test-extension-id", url: "chrome-extension://test-extension-id/popup.html" }
    const ask = (message: object) =>
      new Promise((resolve) => void fakeBrowser.runtime.onMessage.trigger(message, page, resolve))

    expect(await ask({ type: "hand.set", hand: "everywhere" })).toMatchObject({ ok: true })
    expect(await ask({ type: "hand.set", hand: "press" })).toMatchObject({ ok: true })
    expect(removed).toHaveBeenLastCalledWith({ origins: ["<all_urls>"] })

    expect(await ask({ type: "site.keep", origin: "https://www.example.com", keep: true })).toMatchObject({ ok: true })
    expect(await ask({ type: "site.keep", origin: "https://www.example.com", keep: false })).toMatchObject({ ok: true })
    expect(removed).toHaveBeenLastCalledWith({ origins: ["https://www.example.com/*"] })
  })
})
