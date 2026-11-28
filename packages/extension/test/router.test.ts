import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test"
import type { Browser } from "wxt/browser"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { createFakeDrop, DROP, linkTo, type FakeDrop } from "./fake-drop"

let drop: FakeDrop

beforeEach(async () => {
  drop = createFakeDrop()
  vi.stubGlobal("fetch", drop.fetch)
  await fakeBrowser.storage.local.set({ drop: DROP })
  await linkTo(drop)
})
afterEach(() => vi.unstubAllGlobals())

const site = "https://example.com"
// SAFETY: the router reads only the tab's id, so a tab with just an id stands in for a full Tab.
const content = {
  id: "test-extension-id",
  url: `${site}/pricing?plan=team`,
  frameId: 0,
  tab: { id: 7 },
} as Browser.runtime.MessageSender
const page = { id: "test-extension-id", url: "chrome-extension://test-extension-id/popup.html" }

/**
 * Starts the background's real listener and records every answer it gives and every message it sends to a tab, by
 * the kind of sender that asked.
 */
async function background() {
  const { startBackground } = await import("../lib/background")
  const toContent: unknown[] = []
  const toPage: unknown[] = []
  const tabMessages: unknown[] = []
  vi.spyOn(fakeBrowser.tabs, "sendMessage").mockImplementation(async (_tab: number, message: unknown) => {
    tabMessages.push(message)
    return true
  })
  // Menus and commands aren't part of this test, and the fake browser doesn't implement their events.
  vi.spyOn(fakeBrowser.contextMenus.onClicked, "addListener").mockImplementation(() => undefined)
  vi.spyOn(fakeBrowser.commands.onCommand, "addListener").mockImplementation(() => undefined)
  startBackground()
  async function ask(message: object, sender: object) {
    const reply = await new Promise((resolve) => void fakeBrowser.runtime.onMessage.trigger(message, sender, resolve))
    ;(sender === page ? toPage : toContent).push(reply)
    return reply as { ok: boolean; value?: unknown; error?: string }
  }
  return { ask, toContent, toPage, tabMessages }
}

describe("router", () => {
  test("no OAuth or review token reaches a content script", async () => {
    const { ask, toContent, tabMessages } = await background()

    expect(await ask({ type: "review.session", create: true }, content)).toMatchObject({ ok: true })
    expect(await ask({ type: "review.session" }, content)).toMatchObject({ ok: true })
    expect(await ask({ type: "review.fetch", path: "/api/review/comments?page=%2F" }, content)).toMatchObject({
      ok: true,
    })
    expect(await ask({ type: "review.fetch", path: "/api/review/images/abc" }, content)).toMatchObject({ ok: true })
    expect(await ask({ type: "review.presence" }, content)).toMatchObject({
      ok: true,
      value: { ticket: "presence-ticket" },
    })
    expect(await ask({ type: "notes.index" }, content)).toMatchObject({ ok: true })
    expect(await ask({ type: "notes.targets" }, content)).toMatchObject({ ok: true })
    // Refused and failing requests answer too, with errors that must not carry tokens either.
    await ask({ type: "review.fetch", path: "/api/review/notes/session" }, content)
    await ask({ type: "state.get" }, content)
    await ask({ type: "pill.closed" }, content)

    const secrets = drop.secrets()
    expect(secrets.length).toBeGreaterThanOrEqual(3)
    const sent = JSON.stringify([...toContent, ...tabMessages])
    for (const secret of secrets) expect(sent).not.toContain(secret)
    expect(sent).not.toMatch(/\b(access|refresh|review)-[0-9a-f]{16}\b/)
  })

  test("the site comes from the sender, never from the message", async () => {
    const { ask } = await background()
    await ask({ type: "review.session", origin: "https://other.example.com" }, content)
    const request = drop.requests.findLast((r) => r.url.endsWith("/api/review/notes/session"))!
    expect(JSON.parse(request.body!)).toEqual({ origin: site })
  })

  test("content scripts can't send page messages, and pages can't send content messages", async () => {
    const { ask } = await background()
    expect(await ask({ type: "link.remove" }, content)).toEqual({
      ok: false,
      error: "link.remove isn't answered here.",
    })
    expect(await ask({ type: "review.fetch", path: "/api/review/comments" }, page)).toMatchObject({ ok: false })
    expect(await ask({ type: "state.get" }, page)).toMatchObject({ ok: true, value: { drop: DROP } })
  })

  test("frames and other extensions get no answer", async () => {
    const { ask } = await background()
    expect(await ask({ type: "notes.index" }, { ...content, frameId: 3 })).toMatchObject({ ok: false })
    expect(await ask({ type: "notes.index" }, { ...content, id: "another-extension" })).toBeUndefined()
  })

  test("a reply that holds a token is refused", async () => {
    const { route } = await import("../lib/router")
    const { hold } = await import("../lib/secrets")
    hold("review-0123456789abcdef")
    const handlers = {
      page: {},
      content: { "notes.index": async () => ({ leaked: "review-0123456789abcdef" }) },
    }
    // SAFETY: a partial handler table is enough for the one message this test sends.
    const reply = await route({ type: "notes.index" }, content, handlers as never)
    expect(reply).toEqual({ ok: false, error: "Refused: the answer held a token." })
  })
})
