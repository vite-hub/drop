import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test"
import { createFakeDrop, DROP, NOTES, REDIRECT, type FakeDrop } from "./fake-drop"

let drop: FakeDrop

beforeEach(() => {
  drop = createFakeDrop()
  vi.stubGlobal("fetch", drop.fetch)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const load = async () => ({
  oauth: await import("../lib/oauth"),
  storage: await import("../lib/storage"),
})

/** Links through the fake Drop, keeping the authorization URL the extension opened. */
async function linkOnce(oauth: Awaited<ReturnType<typeof load>>["oauth"]) {
  const opened: string[] = []
  const link = await oauth.link(DROP, {
    redirectUri: REDIRECT,
    launch: async (url) => {
      opened.push(url)
      return drop.approve(url)
    },
  })
  return { link, authorize: new URL(opened[0]!) }
}

describe("link", () => {
  test("registers a public client, asks for the notes resource with PKCE S256, and exchanges the code", async () => {
    const { oauth, storage } = await load()
    const { link, authorize } = await linkOnce(oauth)

    const registration = JSON.parse(drop.requests.find((r) => r.url.endsWith("/oauth2/register"))!.body!)
    expect(registration).toMatchObject({
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    })

    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${DROP}/api/auth/oauth2/authorize`)
    const query = authorize.searchParams
    expect(query.get("response_type")).toBe("code")
    expect(query.get("redirect_uri")).toBe(REDIRECT)
    expect(query.get("code_challenge_method")).toBe("S256")
    expect(query.get("code_challenge")).toMatch(/^[\w-]{43}$/)
    expect(query.get("resource")).toBe(NOTES)
    expect(query.get("scope")?.split(" ")).toEqual(expect.arrayContaining(["openid", "offline_access"]))
    expect(query.get("state")).toBeTruthy()

    // The verifier sent with the code hashes to the challenge in the URL.
    const exchange = new URLSearchParams(drop.requests.find((r) => r.url.endsWith("/oauth2/token"))!.body)
    expect(exchange.get("grant_type")).toBe("authorization_code")
    expect(createHash("sha256").update(exchange.get("code_verifier")!).digest("base64url")).toBe(
      query.get("code_challenge"),
    )
    expect(exchange.get("resource")).toBe(NOTES)

    expect(link).toMatchObject({ drop: DROP, name: "Example Reviewer", email: "reviewer@example.com" })
    expect(link.expiresAt).toBeGreaterThan(Date.now() + 250_000)
    expect(await storage.local.get("link")).toEqual(link)
  })

  test("reuses the registered client for the same Drop and redirect URI", async () => {
    const { oauth } = await load()
    await linkOnce(oauth)
    await oauth.unlink()
    await linkOnce(oauth)
    expect(drop.counts.register).toBe(1)
  })

  test("refuses a redirect that comes back with another state", async () => {
    const { oauth, storage } = await load()
    const linking = oauth.link(DROP, {
      redirectUri: REDIRECT,
      launch: async (url) => drop.approve(url).replace(/state=[^&]*/, "state=forged"),
    })
    await expect(linking).rejects.toThrow(oauth.LinkError)
    expect(await storage.local.get("link")).toBeUndefined()
  })
})

describe("refresh", () => {
  test("concurrent callers share one refresh, and the refresh token rotates once", async () => {
    const { oauth, storage } = await load()
    const { link } = await linkOnce(oauth)
    vi.useFakeTimers({ now: link.expiresAt - 10_000, toFake: ["Date"] })

    let open!: () => void
    drop.options.refreshGate = new Promise((resolve) => (open = resolve))
    const callers = Array.from({ length: 5 }, () => oauth.accessToken())
    open()
    const tokens = await Promise.all(callers)

    expect(drop.counts.refresh).toBe(1)
    expect(new Set(tokens).size).toBe(1)
    expect(tokens[0]).not.toBe(link.accessToken)
    const renewed = (await storage.local.get("link"))!
    expect(renewed.accessToken).toBe(tokens[0])
    expect(renewed.refreshToken).not.toBe(link.refreshToken)
    expect(renewed.name).toBe("Example Reviewer")

    const form = new URLSearchParams(drop.requests.findLast((r) => r.url.endsWith("/oauth2/token"))!.body)
    expect(form.get("refresh_token")).toBe(link.refreshToken)
    expect(form.get("resource")).toBe(NOTES)
  })

  test("a fresh access token is returned without a refresh", async () => {
    const { oauth } = await load()
    const { link } = await linkOnce(oauth)
    expect(await oauth.accessToken()).toBe(link.accessToken)
    expect(drop.counts.refresh).toBe(0)
  })

  test("a refused refresh (400) unlinks", async () => {
    const { oauth, storage } = await load()
    const { link } = await linkOnce(oauth)
    vi.useFakeTimers({ now: link.expiresAt, toFake: ["Date"] })
    drop.revokeAll()
    const unlinked = vi.fn()
    oauth.onUnlink(unlinked)

    await expect(oauth.accessToken()).rejects.toThrow(oauth.Unlinked)
    expect(await storage.local.get("link")).toBeUndefined()
    expect(unlinked).toHaveBeenCalledOnce()
    await expect(oauth.accessToken()).rejects.toThrow(oauth.Unlinked)
  })

  test("a Drop that's down (503) keeps the link", async () => {
    const { oauth, storage } = await load()
    const { link } = await linkOnce(oauth)
    vi.useFakeTimers({ now: link.expiresAt, toFake: ["Date"] })
    drop.options.refreshStatus = 503

    const error: unknown = await oauth.accessToken().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(oauth.LinkError)
    expect(error).not.toBeInstanceOf(oauth.Unlinked)
    expect(await storage.local.get("link")).toEqual(link)
  })
})
