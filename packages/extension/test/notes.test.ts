import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { createFakeDrop, linkTo, type FakeDrop } from "./fake-drop"

let drop: FakeDrop

beforeEach(async () => {
  drop = createFakeDrop()
  vi.stubGlobal("fetch", drop.fetch)
  await linkTo(drop)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const site = "https://example.com"
const review = { id: "review-1", name: "Acme launch", access: "Team" }

describe("review sessions", () => {
  test("one session per site and target, reused until shortly before it expires", async () => {
    drop.reviews.set(site, [review])
    const notes = await import("../lib/notes")
    const first = (await notes.reviewSession(site, review.id))!
    expect(await notes.reviewSession(site, review.id)).toEqual(first)
    expect(drop.counts.session).toBe(1)

    await notes.reviewSession(site, "notes", { create: true })
    await notes.reviewSession("https://www.example.com", "notes", { create: true })
    expect(drop.counts.session).toBe(3)

    vi.useFakeTimers({ now: first.expiresAt - 10_000, toFake: ["Date"] })
    const next = (await notes.reviewSession(site, review.id))!
    expect(next.token).not.toBe(first.token)
    expect(drop.counts.session).toBe(4)
  })

  test("a site without notes answers no session and creates nothing until asked to", async () => {
    const notes = await import("../lib/notes")
    expect(await notes.reviewSession(site, "notes")).toBeNull()
    expect(drop.notesDrops.size).toBe(0)
    expect(JSON.parse(drop.requests.findLast((r) => r.url.endsWith("/session"))!.body!)).toEqual({
      origin: site,
      target: "notes",
    })

    const created = (await notes.reviewSession(site, "notes", { create: true }))!
    expect(created.reply).toEqual({
      name: "Example Reviewer",
      expiresAt: created.expiresAt,
      title: "Notes on example.com",
    })
    expect(JSON.parse(drop.requests.findLast((r) => r.url.endsWith("/session"))!.body!)).toEqual({
      origin: site,
      target: "notes",
      create: true,
    })
    expect(drop.notesDrops.size).toBe(1)
    expect(await notes.reviewSession(site, "notes")).toEqual(created)
  })

  test("callers that arrive together share one session request", async () => {
    drop.reviews.set(site, [review])
    const notes = await import("../lib/notes")
    const sessions = await Promise.all(Array.from({ length: 4 }, () => notes.reviewSession(site, review.id)))
    expect(new Set(sessions.map((s) => s?.token)).size).toBe(1)
    expect(drop.counts.session).toBe(1)
  })

  test("unlinking forgets every session", async () => {
    const notes = await import("../lib/notes")
    const oauth = await import("../lib/oauth")
    await notes.reviewSession(site, "notes", { create: true })
    await oauth.unlink()
    await expect(notes.reviewSession(site, "notes")).rejects.toThrow(oauth.Unlinked)
  })
})

describe("review API proxy", () => {
  test("sends the review token for the site, and starts a new session after a 401", async () => {
    const notes = await import("../lib/notes")
    await notes.reviewSession(site, "notes", { create: true })
    const reply = await notes.reviewFetch(site, "notes", "/api/review/comments?page=%2F", { method: "GET" })
    expect(reply).toMatchObject({ status: 200, text: expect.stringContaining('"origin":"https://example.com"') })

    drop.reviewTokens.clear()
    const again = await notes.reviewFetch(site, "notes", "/api/review/comments?page=%2F", { method: "GET" })
    expect(again.status).toBe(200)
    expect(drop.counts.session).toBe(2)
  })

  test("without a session, the review API answers 401 without asking the Drop", async () => {
    const notes = await import("../lib/notes")
    const reply = await notes.reviewFetch(site, "notes", "/api/review/comments?page=%2F", { method: "GET" })
    expect(reply.status).toBe(401)
    expect(drop.counts.review).toBe(0)
  })

  test("images come back as base64", async () => {
    const notes = await import("../lib/notes")
    await notes.reviewSession(site, "notes", { create: true })
    drop.shots.set("abc", new Uint8Array([0x52, 0x49, 0x46, 0x46]))
    const reply = await notes.reviewFetch(site, "notes", "/api/review/images/abc", { method: "GET" })
    expect(reply).toEqual({ status: 200, type: "image/webp", base64: "UklGRg==" })
  })

  test("refuses paths outside the review API and inside the notes API", async () => {
    const notes = await import("../lib/notes")
    for (const path of [
      "/api/drops",
      "/api/review/notes/index",
      "/api/review/../auth/oauth2/token",
      "https://evil.example.com/api/review/comments",
      "//evil.example.com/api/review/comments",
    ])
      await expect(notes.reviewFetch(site, "notes", path, { method: "GET" })).rejects.toThrow(notes.NotesError)
    expect(drop.counts.review).toBe(0)
  })
})

describe("notes API", () => {
  test("the index is kept for the browser session and revalidates with its ETag", async () => {
    drop.reviews.set(site, [review])
    const notes = await import("../lib/notes")
    const first = await notes.siteIndex()
    expect(first).toMatchObject({ origins: [site], etag: expect.any(String) })
    expect(await notes.siteIndex()).toEqual(first)
    expect(drop.counts.index).toBe(1)
    expect(await fakeBrowser.storage.session.get("index")).toEqual({ index: first })

    await notes.siteIndex({ fresh: true })
    expect(drop.requests.findLast((r) => r.url.endsWith("/index"))).toBeDefined()
    expect(drop.counts.index).toBe(2)
    expect(notes.indexed(await notes.siteIndex(), site)).toBe(true)
    expect(notes.indexed(await notes.siteIndex(), "https://example.org")).toBe(false)
  })

  test("creating notes adds the site to the index without asking again", async () => {
    const notes = await import("../lib/notes")
    expect(notes.indexed(await notes.siteIndex(), site)).toBe(false)
    await notes.reviewSession(site, "notes", { create: true })
    expect(notes.indexed(await notes.siteIndex(), site)).toBe(true)
    expect(drop.counts.index).toBe(1)
  })

  test("targets send the site's origin with the access token, and always end with the notes", async () => {
    drop.reviews.set(site, [review])
    const notes = await import("../lib/notes")
    expect(await notes.siteTargets(site)).toEqual([review, notes.NOTES_TARGET])
    const request = drop.requests.findLast((r) => r.url.endsWith("/targets"))!
    expect(JSON.parse(request.body!)).toEqual({ origin: site })
    expect(request.authorization).toMatch(/^Bearer access-/)
  })
})
