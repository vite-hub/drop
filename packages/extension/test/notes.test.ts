import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test"
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

describe("review sessions", () => {
  test("one session per site and target, reused until shortly before it expires", async () => {
    const notes = await import("../lib/notes")
    const first = await notes.reviewSession(site)
    expect(await notes.reviewSession(site)).toEqual(first)
    expect(drop.counts.session).toBe(1)

    await notes.reviewSession(site, { target: "t1" })
    await notes.reviewSession("https://www.example.com")
    expect(drop.counts.session).toBe(3)

    vi.useFakeTimers({ now: first.expires - 10_000, toFake: ["Date"] })
    const next = await notes.reviewSession(site)
    expect(next.token).not.toBe(first.token)
    expect(drop.counts.session).toBe(4)
  })

  test("callers that arrive together share one session request", async () => {
    const notes = await import("../lib/notes")
    const sessions = await Promise.all(Array.from({ length: 4 }, () => notes.reviewSession(site)))
    expect(new Set(sessions.map((s) => s.token)).size).toBe(1)
    expect(drop.counts.session).toBe(1)
  })

  test("create always asks the Drop, and the answer is cached", async () => {
    const notes = await import("../lib/notes")
    await notes.reviewSession(site)
    const created = await notes.reviewSession(site, { create: true })
    expect(drop.counts.session).toBe(2)
    expect(JSON.parse(drop.requests.findLast((r) => r.url.endsWith("/session"))!.body!)).toEqual({
      origin: site,
      create: true,
    })
    expect(await notes.reviewSession(site)).toEqual(created)
    expect(drop.counts.session).toBe(2)
  })

  test("unlinking forgets every session", async () => {
    const notes = await import("../lib/notes")
    const oauth = await import("../lib/oauth")
    await notes.reviewSession(site)
    await oauth.unlink()
    await expect(notes.reviewSession(site)).rejects.toThrow(oauth.Unlinked)
  })
})

describe("review API proxy", () => {
  test("sends the review token for the site, and starts a new session after a 401", async () => {
    const notes = await import("../lib/notes")
    const reply = await notes.reviewFetch(site, { path: "/api/review/comments?page=%2F" })
    expect(reply).toMatchObject({ status: 200, text: expect.stringContaining('"origin":"https://example.com"') })

    drop.reviewTokens.clear()
    const again = await notes.reviewFetch(site, { path: "/api/review/comments?page=%2F" })
    expect(again.status).toBe(200)
    expect(drop.counts.session).toBe(2)
  })

  test("images come back as base64", async () => {
    const notes = await import("../lib/notes")
    const reply = await notes.reviewFetch(site, { path: "/api/review/images/abc" })
    expect(reply).toEqual({ status: 200, type: "image/png", base64: "iVBORw==" })
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
      await expect(notes.reviewFetch(site, { path })).rejects.toThrow(notes.NotesError)
    expect(drop.counts.review).toBe(0)
  })
})

describe("notes API", () => {
  test("the index revalidates with its ETag", async () => {
    const notes = await import("../lib/notes")
    const first = await notes.notesIndex()
    expect(await notes.notesIndex()).toEqual(first)
    expect(drop.requests.findLast((r) => r.url.endsWith("/index"))).toBeDefined()
    expect(drop.counts.index).toBe(2)
  })

  test("targets send the site's origin with the access token", async () => {
    const notes = await import("../lib/notes")
    await notes.notesTargets(site)
    const request = drop.requests.findLast((r) => r.url.endsWith("/targets"))!
    expect(JSON.parse(request.body!)).toEqual({ origin: site })
    expect(request.authorization).toMatch(/^Bearer access-/)
  })
})
