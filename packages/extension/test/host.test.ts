import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test"
import { fakeBrowser } from "wxt/testing/fake-browser"
import type { ReviewHostRequest } from "../../../shared/review-host"
import { createFakeDrop, DROP, linkTo, type FakeDrop } from "./fake-drop"

let drop: FakeDrop

beforeEach(async () => {
  drop = createFakeDrop()
  vi.stubGlobal("fetch", drop.fetch)
  await fakeBrowser.storage.local.set({ drop: DROP })
})
afterEach(() => vi.unstubAllGlobals())

const site = "https://example.com"
const review = { id: "review-1", name: "Acme launch", access: "Team" }
const from = { origin: site, tabId: 7, windowId: 1 }

type Fields<T> = T extends unknown ? Omit<T, "v" | "target"> & { target?: string } : never

async function ask(request: Fields<ReviewHostRequest>) {
  const { host } = await import("../lib/host")
  // SAFETY: the test adds the version and default target that every request carries.
  return host({ v: 1, target: "notes", ...request } as ReviewHostRequest, from)
}

const sent = () => drop.requests.length

describe("before linking", () => {
  test("the pill starts with private notes and asks nothing of the Drop", async () => {
    const { start } = await import("../lib/host")
    expect(await start(site, { drop: DROP })).toEqual({
      drop: DROP,
      targets: [{ id: "notes", name: "My notes", access: "Private" }],
    })
    expect(await ask({ type: "session" })).toBeNull()
    expect(await ask({ type: "related", probe: true })).toMatchObject({ status: 200, text: '{"linked":false}' })
    expect(sent()).toBe(0)
  })

  test("connecting opens the welcome page instead", async () => {
    const create = vi.spyOn(fakeBrowser.tabs, "create")
    await expect(ask({ type: "connect", origin: site })).rejects.toThrow("Connect the extension to your Drop first.")
    expect(create).toHaveBeenCalledWith({ url: expect.stringMatching(/\/welcome\.html$/) })
  })

  test("Drop's own pages and its content origin are refused", async () => {
    const { start } = await import("../lib/host")
    expect(await start(DROP, { drop: DROP })).toEqual({ blocked: true })
    expect(await start("https://abc-drop.example.com", { drop: DROP, content: "https://*-drop.example.com" })).toEqual({
      blocked: true,
    })
  })
})

describe("linked", () => {
  beforeEach(async () => {
    await linkTo(drop)
    drop.requests.length = 0
  })

  test("a site with neither notes nor a review costs one index request, then none", async () => {
    const { start } = await import("../lib/host")
    expect(await start(site, { drop: DROP })).toMatchObject({ targets: [{ id: "notes" }] })
    expect(await ask({ type: "session" })).toBeNull()
    expect(await ask({ type: "related", probe: true })).toMatchObject({ status: 200 })
    expect(await ask({ type: "presence" })).toMatchObject({ status: 404 })
    expect(drop.requests.map((r) => new URL(r.url).pathname)).toEqual(["/api/review/notes/index"])
  })

  test("a covered site lists its reviews first and resumes the remembered target", async () => {
    drop.reviews.set(site, [review])
    const { start } = await import("../lib/host")
    expect(await start(site, { drop: DROP })).toEqual({
      drop: DROP,
      targets: [review, { id: "notes", name: "My notes", access: "Private" }],
    })
    expect(await ask({ type: "session", target: review.id })).toMatchObject({ title: "Acme launch" })
    expect(await start(site, { drop: DROP })).toMatchObject({ target: review.id })
  })

  test("connect creates the notes, and the next session and index know them", async () => {
    const connected = await ask({ type: "connect", origin: "https://ignored.example.com" })
    expect(connected).toEqual({
      name: "Example Reviewer",
      expiresAt: expect.any(Number),
      title: "Notes on example.com",
    })
    expect(JSON.stringify(connected)).not.toContain("review-")
    expect(drop.notesDrops.has(site)).toBe(true)
    expect(await ask({ type: "session" })).toEqual(connected)
    expect(await fakeBrowser.storage.local.get("picked")).toEqual({ picked: { [site]: "notes" } })
  })

  test("list, call and upload reach the review API with the session's token", async () => {
    await ask({ type: "connect", origin: site })
    const shot = btoa("RIFF....WEBP")
    const uploaded = await ask({
      type: "upload",
      path: "/api/review/comments",
      data: { body: "Bigger button", page: "/pricing", requestId: "r1" },
      files: [{ field: "screenshot", name: "shot.webp", type: "image/webp", base64: shot }],
    })
    expect(uploaded).toMatchObject({ status: 200 })
    const [thread] = drop.threads.get(drop.notesDrops.get(site)!)!
    expect(thread).toMatchObject({ n: 1, body: "Bigger button", page: "/pricing", screenshot: expect.any(String) })
    expect(new TextDecoder().decode(drop.shots.get(thread!.screenshot!))).toBe("RIFF....WEBP")

    const listed = await ask({ type: "list", page: "/pricing", refresh: true })
    expect(JSON.parse((listed as { text: string }).text).threads).toHaveLength(1)
    const last = drop.requests.at(-1)!
    expect([last.method, new URL(last.url).pathname + new URL(last.url).search]).toEqual([
      "POST",
      "/api/review/comments/refresh?page=%2Fpricing",
    ])
    expect(last.authorization).toMatch(/^Bearer review-/)

    const image = await ask({ type: "call", path: `/api/review/images/${thread!.screenshot}`, method: "GET" })
    expect(image).toMatchObject({ status: 200, type: "image/webp", base64: shot })
    await expect(ask({ type: "call", path: "/api/review/comments", method: "DELETE" as "GET" })).rejects.toThrow()
  })

  test("related probes ask Drop only once a session exists", async () => {
    drop.reviews.set(site, [review])
    expect(await ask({ type: "related", probe: true, target: review.id })).toMatchObject({ text: '{"linked":false}' })
    expect(drop.counts.review).toBe(0)
    await ask({ type: "session", target: review.id })
    expect(await ask({ type: "related", probe: true, target: review.id })).toMatchObject({ status: 200 })
    expect(drop.counts.review).toBe(1)
  })

  test("presence asks for a ticket on shared reviews only", async () => {
    drop.reviews.set(site, [review])
    expect(await ask({ type: "presence", target: review.id })).toMatchObject({
      status: 200,
      text: expect.stringContaining('"ticket":"presence-ticket"'),
    })
    await ask({ type: "connect", origin: site })
    const before = drop.counts.review
    expect(await ask({ type: "presence" })).toMatchObject({ status: 404 })
    expect(drop.counts.review).toBe(before)
  })

  test("capture takes the visible tab of the sender's window, and only while the tab shows", async () => {
    const capture = vi
      .spyOn(fakeBrowser.tabs, "captureVisibleTab")
      // SAFETY: the fake types captureVisibleTab as returning void; the real API resolves to a data URL.
      .mockImplementation((async () => "data:image/png;base64,AAAA") as never)
    const get = vi.spyOn(fakeBrowser.tabs, "get")
    get.mockResolvedValueOnce({ id: 7, active: true } as never)
    expect(await ask({ type: "capture" })).toEqual({ dataUrl: "data:image/png;base64,AAAA" })
    expect(capture).toHaveBeenCalledWith(1, { format: "png" })
    get.mockResolvedValueOnce({ id: 7, active: false } as never)
    await expect(ask({ type: "capture" })).rejects.toThrow("Show this tab")
  })

  test("open sends the token to Drop's own page, never back to the page", async () => {
    const tab = vi.spyOn(fakeBrowser.tabs, "create").mockResolvedValue({} as never)
    const popup = vi.spyOn(fakeBrowser.windows, "create").mockResolvedValue({} as never)
    await ask({ type: "connect", origin: site })
    expect(await ask({ type: "open", what: "review" })).toEqual({ opened: true })
    expect(tab).toHaveBeenCalledWith({
      url: expect.stringMatching(/^https:\/\/drop\.example\.com\/review\/open#review-/),
    })
    await ask({ type: "open", what: "copy-prompt" })
    expect(popup).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringMatching(/\/review\/open\?prompt#review-/), type: "popup" }),
    )
  })

  test("a request from another version of the script is refused", async () => {
    const { host } = await import("../lib/host")
    // SAFETY: a request as an older script would send it.
    const old = { v: 0, type: "session", target: "notes" } as unknown as ReviewHostRequest
    await expect(host(old, from)).rejects.toThrow("Reload the page.")
  })
})
