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
const review = { id: "review-1", name: "Acme launch", access: "Team" }
// SAFETY: the router reads only the tab's id and window, so a tab with just those stands in for a full Tab.
const content = {
  id: "test-extension-id",
  url: `${site}/pricing?plan=team`,
  frameId: 0,
  tab: { id: 7, windowId: 1 },
} as Browser.runtime.MessageSender
const hostRequest = (request: object) => ({ type: "review.host", request: { v: 1, target: "notes", ...request } })
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

    drop.reviews.set(site, [review])
    expect(await ask({ type: "notes.targets" }, content)).toMatchObject({
      ok: true,
      value: { drop: DROP, targets: [review, { id: "notes" }] },
    })
    expect(await ask(hostRequest({ type: "connect", origin: site }), content)).toMatchObject({ ok: true })
    expect(await ask(hostRequest({ type: "session" }), content)).toMatchObject({ ok: true })
    expect(await ask(hostRequest({ type: "list", page: "/" }), content)).toMatchObject({ ok: true })
    expect(
      await ask(
        hostRequest({ type: "upload", path: "/api/review/comments", data: { body: "Hi", page: "/" }, files: [] }),
        content,
      ),
    ).toMatchObject({ ok: true, value: { status: 200 } })
    expect(await ask(hostRequest({ type: "related", probe: true }), content)).toMatchObject({ ok: true })
    expect(await ask(hostRequest({ type: "presence", target: review.id }), content)).toMatchObject({
      ok: true,
      value: { status: 200, text: expect.stringContaining("presence-ticket") },
    })
    await ask(hostRequest({ type: "call", path: "/api/review/notes/session", method: "POST" }), content)
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
    await ask(hostRequest({ type: "connect", origin: "https://other.example.com" }), content)
    const request = drop.requests.findLast((r) => r.url.endsWith("/api/review/notes/session"))!
    expect(JSON.parse(request.body!)).toEqual({ origin: site, target: "notes", create: true })
  })

  test("content scripts can't send page messages, and pages can't send content messages", async () => {
    const { ask } = await background()
    expect(await ask({ type: "link.remove" }, content)).toEqual({
      ok: false,
      error: "link.remove isn't answered here.",
    })
    expect(await ask(hostRequest({ type: "list", page: "/" }), page)).toMatchObject({ ok: false })
    expect(await ask({ type: "state.get" }, page)).toMatchObject({ ok: true, value: { drop: DROP } })
  })

  test("frames and other extensions get no answer", async () => {
    const { ask } = await background()
    expect(await ask({ type: "notes.targets" }, { ...content, frameId: 3 })).toMatchObject({ ok: false })
    expect(await ask({ type: "notes.targets" }, { ...content, id: "another-extension" })).toBeUndefined()
  })

  test("a reply that holds a token is refused", async () => {
    const { route } = await import("../lib/router")
    const { hold } = await import("../lib/secrets")
    hold("review-0123456789abcdef")
    const handlers = {
      page: {},
      content: { "notes.targets": async () => ({ leaked: "review-0123456789abcdef" }) },
    }
    // SAFETY: a partial handler table is enough for the one message this test sends.
    const reply = await route({ type: "notes.targets" }, content, handlers as never)
    expect(reply).toEqual({ ok: false, error: "Refused: the answer held a token." })
  })
})
