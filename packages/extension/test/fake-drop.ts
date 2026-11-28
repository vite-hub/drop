// An in-memory Drop: OAuth discovery, DCR, the code flow with PKCE S256, rotating refresh tokens, the notes API and
// the review API. Unit tests swap global fetch for `fakeDrop.fetch`; the browser harness serves it over HTTP.
import { createHash, randomBytes } from "node:crypto"

export const DROP = "https://drop.example.com"
export const NOTES = `${DROP}/api/review/notes`
export const REDIRECT = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/"

export interface Target {
  id: string
  name: string
  access: string
}

export interface Thread {
  n: number
  requestId?: string
  body: string
  author: { name: string; image: null }
  createdAt: number
  resolved: boolean
  mine: boolean
  canResolve: boolean
  page: string
  element: { selector?: string; label?: string }
  spot?: unknown
  box: { ox?: number; oy?: number; ow?: number; oh?: number }
  screenshot: string | null
  images: never[]
  replies: never[]
}

const NOTES_TARGET: Target = { id: "notes", name: "My notes", access: "Private" }
const READER = { name: "Example Reviewer", email: "reviewer@example.com" }

const id = (prefix: string) => `${prefix}-${randomBytes(8).toString("hex")}`
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers as Record<string, string>) },
  })

const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")

function bearer(request: Request) {
  return request.headers.get("authorization")?.replace(/^Bearer /, "")
}

function idToken() {
  return `${part({ alg: "none" })}.${part({ ...READER, sub: "user-1" })}.signature`
}

export function createFakeDrop(drop = DROP) {
  const clients = new Map<string, { redirectUris: string[] }>()
  const codes = new Map<string, { clientId: string; challenge: string; redirectUri: string; resource: string }>()
  const refreshTokens = new Map<string, string>()
  const accessTokens = new Set<string>()
  const reviewTokens = new Map<string, { origin: string; drop: string }>()
  const issued = new Set<string>()
  const reviews = new Map<string, Target[]>()
  const notesDrops = new Map<string, string>()
  const threads = new Map<string, Thread[]>()
  const shots = new Map<string, Uint8Array<ArrayBuffer>>()
  const counts = { register: 0, token: 0, refresh: 0, session: 0, index: 0, targets: 0, review: 0 }
  const requests: { url: string; method: string; at: number; authorization?: string; body?: string }[] = []
  const options = {
    accessSeconds: 300,
    sessionMs: 300_000,
    /** Answers the next refresh with this status instead of a token. */
    refreshStatus: undefined as number | undefined,
    /** Holds each refresh until this resolves, so concurrent callers overlap. */
    refreshGate: undefined as Promise<void> | undefined,
    reviewScript: "",
    presence: true,
  }

  function issue(clientId: string) {
    const access = id("access")
    const refresh = id("refresh")
    accessTokens.add(access)
    refreshTokens.set(refresh, clientId)
    issued.add(access).add(refresh)
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: options.accessSeconds,
      scope: "openid profile email offline_access",
      id_token: idToken(),
    }
  }

  const indexed = () => [...new Set([...reviews.keys(), ...notesDrops.keys()])].sort()
  const etag = () => `"${createHash("sha256").update(indexed().join("\n")).digest("hex").slice(0, 16)}"`
  const targetsFor = (origin: string) => [...(reviews.get(origin) ?? []), NOTES_TARGET]
  const titleOf = (origin: string, dropId: string) =>
    (reviews.get(origin) ?? []).find((target) => target.id === dropId)?.name ?? `Notes on ${new URL(origin).host}`

  function session(body: { origin?: string; target?: string; create?: boolean }) {
    const { origin, target, create } = body
    if (!origin || !target) return json({ message: "origin and target are required" }, { status: 400 })
    let dropId: string | undefined
    if (target === NOTES_TARGET.id) {
      dropId = notesDrops.get(origin)
      if (!dropId && !create) return json({ message: "No notes here yet." }, { status: 404 })
      if (!dropId) {
        dropId = id("notes")
        notesDrops.set(origin, dropId)
      }
    } else if ((reviews.get(origin) ?? []).some((covering) => covering.id === target)) dropId = target
    if (!dropId) return json({ message: "That review doesn't cover this site." }, { status: 403 })
    const token = id("review")
    reviewTokens.set(token, { origin, drop: dropId })
    issued.add(token)
    return json({
      token,
      expiresAt: Date.now() + options.sessionMs,
      origin,
      title: titleOf(origin, dropId),
      name: READER.name,
    })
  }

  async function comment(request: Request, dropId: string) {
    const multipart = request.headers.get("content-type")?.startsWith("multipart/")
    const form = multipart ? await request.formData() : new FormData()
    const raw = form.get("data")
    // SAFETY: the review script's comment fields; the fake keeps them as they came.
    const data = (typeof raw === "string" ? JSON.parse(raw) : await request.json()) as Record<string, unknown> & {
      body: string
      page: string
    }
    const list = threads.get(dropId) ?? []
    threads.set(dropId, list)
    const shot = form.get("screenshot")
    let screenshot: string | null = null
    if (shot instanceof Blob) {
      screenshot = id("shot")
      shots.set(screenshot, new Uint8Array(await shot.arrayBuffer()))
    }
    const thread: Thread = {
      n: list.length + 1,
      ...(typeof data.requestId === "string" ? { requestId: data.requestId } : {}),
      body: data.body,
      author: { name: READER.name, image: null },
      createdAt: Date.now(),
      resolved: false,
      mine: true,
      canResolve: true,
      page: data.page,
      element: {
        ...(typeof data.selector === "string" ? { selector: data.selector } : {}),
        ...(typeof data.label === "string" ? { label: data.label } : {}),
      },
      spot: data.spot,
      // SAFETY: the box's four numbers, as the script sends them.
      box: { ox: data.ox as number, oy: data.oy as number, ow: data.ow as number, oh: data.oh as number },
      screenshot,
      images: [],
      replies: [],
    }
    list.push(thread)
    return json({ n: thread.n, thread })
  }

  async function review(request: Request, url: URL) {
    counts.review++
    const token = bearer(request)
    if (!token && url.pathname === "/api/review/related") return json({ linked: false })
    const current = reviewTokens.get(token ?? "")
    if (!current) return json({ message: "Your review session ended." }, { status: 401 })
    const list = threads.get(current.drop) ?? []
    const page = url.searchParams.get("page")
    if (url.pathname === "/api/review/presence" && !options.presence)
      return json({ message: "No Realtime here." }, { status: 404 })
    if (url.pathname === "/api/review/presence")
      return json({
        room: `room-${current.drop}`,
        ticket: "presence-ticket",
        you: { id: "user-1", name: READER.name },
        expiresAt: Date.now() + 60_000,
      })
    if (url.pathname === "/api/review/related") return json({ linked: false, groups: [] })
    if (url.pathname.startsWith("/api/review/images/")) {
      const shot = shots.get(decodeURIComponent(url.pathname.slice("/api/review/images/".length)))
      if (!shot) return json({ message: "No such image." }, { status: 404 })
      return new Response(shot, { headers: { "content-type": "image/webp" } })
    }
    if (url.pathname === "/api/review/comments" && request.method === "POST") return comment(request, current.drop)
    if (url.pathname === "/api/review/comments" || url.pathname === "/api/review/comments/refresh")
      return json({ threads: list.filter((thread) => !page || thread.page === page), origin: current.origin })
    return json({ message: "not found" }, { status: 404 })
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.origin !== drop) throw new TypeError("Failed to fetch")
    const multipart = request.headers.get("content-type")?.startsWith("multipart/")
    const body = request.method === "GET" || multipart ? undefined : await request.clone().text()
    requests.push({
      url: request.url,
      method: request.method,
      at: Date.now(),
      ...(request.headers.get("authorization") ? { authorization: request.headers.get("authorization")! } : {}),
      ...(body ? { body } : {}),
    })
    const signedIn = accessTokens.has(bearer(request) ?? "")
    switch (url.pathname) {
      case "/.well-known/oauth-authorization-server":
        return json({
          issuer: `${drop}/api/auth`,
          authorization_endpoint: `${drop}/api/auth/oauth2/authorize`,
          token_endpoint: `${drop}/api/auth/oauth2/token`,
          registration_endpoint: `${drop}/api/auth/oauth2/register`,
          revocation_endpoint: `${drop}/api/auth/oauth2/revoke`,
          code_challenge_methods_supported: ["S256"],
        })
      case "/api/auth/oauth2/authorize":
        return new Response(null, { status: 302, headers: { location: approve(request.url) } })
      case "/api/auth/oauth2/register": {
        counts.register++
        const registration = JSON.parse(body!) as { redirect_uris: string[]; token_endpoint_auth_method: string }
        const clientId = id("client")
        clients.set(clientId, { redirectUris: registration.redirect_uris })
        return json(
          {
            client_id: clientId,
            redirect_uris: registration.redirect_uris,
            token_endpoint_auth_method: registration.token_endpoint_auth_method,
          },
          { status: 201 },
        )
      }
      case "/api/auth/oauth2/token": {
        counts.token++
        const form = new URLSearchParams(body)
        if (form.get("grant_type") === "authorization_code") {
          const grant = codes.get(form.get("code") ?? "")
          codes.delete(form.get("code") ?? "")
          if (!grant || grant.clientId !== form.get("client_id"))
            return json({ error: "invalid_grant" }, { status: 400 })
          const challenge = createHash("sha256")
            .update(form.get("code_verifier") ?? "")
            .digest("base64url")
          if (challenge !== grant.challenge) return json({ error: "invalid_grant" }, { status: 400 })
          if (form.get("redirect_uri") !== grant.redirectUri || form.get("resource") !== grant.resource)
            return json({ error: "invalid_target" }, { status: 400 })
          return json(issue(grant.clientId))
        }
        if (form.get("grant_type") === "refresh_token") {
          counts.refresh++
          await options.refreshGate
          if (options.refreshStatus) return json({ error: "invalid_grant" }, { status: options.refreshStatus })
          const token = form.get("refresh_token") ?? ""
          const clientId = refreshTokens.get(token)
          if (!clientId || clientId !== form.get("client_id")) return json({ error: "invalid_grant" }, { status: 400 })
          refreshTokens.delete(token)
          return json(issue(clientId))
        }
        return json({ error: "unsupported_grant_type" }, { status: 400 })
      }
      case "/api/auth/oauth2/revoke":
        refreshTokens.delete(new URLSearchParams(body).get("token") ?? "")
        return new Response(null, { status: 200 })
      case "/review.js":
        return new Response(options.reviewScript, { headers: { "content-type": "text/javascript; charset=utf-8" } })
      case "/api/review/notes/hello":
        return json({ drop, name: "Example Drop", version: "0.1.0", content: drop.replace("://", "://*-") })
      case "/api/review/notes/index": {
        if (!signedIn) return json({ error: "unauthorized" }, { status: 401 })
        counts.index++
        const tag = etag()
        if (request.headers.get("if-none-match") === tag) return new Response(null, { status: 304 })
        return json({ origins: indexed() }, { headers: { etag: tag } })
      }
      case "/api/review/notes/targets": {
        if (!signedIn) return json({ error: "unauthorized" }, { status: 401 })
        counts.targets++
        const { origin } = JSON.parse(body!) as { origin: string }
        return json({ targets: targetsFor(origin) })
      }
      case "/api/review/notes/session":
        if (!signedIn) return json({ error: "unauthorized" }, { status: 401 })
        counts.session++
        return session(JSON.parse(body!))
    }
    if (url.pathname.startsWith("/api/review/")) return review(request, url)
    return json({ error: "not found" }, { status: 404 })
  }

  /** Plays the Drop's consent screen: approves the authorization request and returns the redirect URL. */
  function approve(authorizeUrl: string) {
    const url = new URL(authorizeUrl)
    const query = url.searchParams
    const clientId = query.get("client_id") ?? ""
    const redirectUri = query.get("redirect_uri") ?? ""
    if (!clients.get(clientId)?.redirectUris.includes(redirectUri)) throw new Error("unknown client or redirect")
    const code = id("code")
    codes.set(code, {
      clientId,
      challenge: query.get("code_challenge") ?? "",
      redirectUri,
      resource: query.get("resource") ?? "",
    })
    const back = new URL(redirectUri)
    back.searchParams.set("code", code)
    back.searchParams.set("state", query.get("state") ?? "")
    return back.href
  }

  return {
    drop,
    fetch: (input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init)),
    approve,
    counts,
    requests,
    options,
    clients,
    reviewTokens,
    reviews,
    notesDrops,
    threads,
    shots,
    /** Every token the Drop issued, for checking that none leaves the background. */
    secrets: () => [...issued],
    revokeAll: () => refreshTokens.clear(),
  }
}

export type FakeDrop = ReturnType<typeof createFakeDrop>

/** Links the extension to the fake Drop through the real code flow. */
export async function linkTo(fake: FakeDrop) {
  const oauth = await import("../lib/oauth")
  return oauth.link(fake.drop, { redirectUri: REDIRECT, launch: async (url) => fake.approve(url) })
}
