// An in-memory Drop at https://drop.example.com: OAuth discovery, DCR, the code flow with PKCE S256, rotating refresh
// tokens, the notes API and the review API. Tests swap global fetch for `fakeDrop.fetch` and read its counters.
import { createHash, randomBytes } from "node:crypto"

export const DROP = "https://drop.example.com"
export const NOTES = `${DROP}/api/review/notes`
export const REDIRECT = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/"

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

function idToken(name: string, email: string) {
  return `${part({ alg: "none" })}.${part({ name, email, sub: "user-1" })}.signature`
}

export function createFakeDrop() {
  const clients = new Map<string, { redirectUris: string[] }>()
  const codes = new Map<string, { clientId: string; challenge: string; redirectUri: string; resource: string }>()
  const refreshTokens = new Map<string, string>()
  const accessTokens = new Set<string>()
  const reviewTokens = new Map<string, { origin: string; target?: string }>()
  const issued = new Set<string>()
  const counts = { register: 0, token: 0, refresh: 0, session: 0, index: 0, review: 0 }
  const requests: { url: string; authorization?: string; body?: string }[] = []
  const options = {
    accessSeconds: 300,
    sessionMs: 300_000,
    /** Answers the next refresh with this status instead of a token. */
    refreshStatus: undefined as number | undefined,
    /** Holds each refresh until this resolves, so concurrent callers overlap. */
    refreshGate: undefined as Promise<void> | undefined,
    indexEtag: '"index-1"',
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
      id_token: idToken("Example Reviewer", "reviewer@example.com"),
    }
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.origin !== DROP) throw new TypeError("Failed to fetch")
    const body = request.method === "GET" ? undefined : await request.clone().text()
    requests.push({
      url: request.url,
      ...(request.headers.get("authorization") ? { authorization: request.headers.get("authorization")! } : {}),
      ...(body ? { body } : {}),
    })
    switch (url.pathname) {
      case "/.well-known/oauth-authorization-server":
        return json({
          issuer: `${DROP}/api/auth`,
          authorization_endpoint: `${DROP}/api/auth/oauth2/authorize`,
          token_endpoint: `${DROP}/api/auth/oauth2/token`,
          registration_endpoint: `${DROP}/api/auth/oauth2/register`,
          revocation_endpoint: `${DROP}/api/auth/oauth2/revoke`,
          code_challenge_methods_supported: ["S256"],
        })
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
      case "/api/review/notes/hello":
        return json({ drop: DROP, name: "Example Drop", version: "0.1.0", content: "https://*-drop.example.com" })
      case "/api/review/notes/index": {
        if (!accessTokens.has(bearer(request) ?? "")) return json({ error: "unauthorized" }, { status: 401 })
        counts.index++
        if (request.headers.get("if-none-match") === options.indexEtag) return new Response(null, { status: 304 })
        return json({ sites: [{ origin: "https://example.com" }] }, { headers: { etag: options.indexEtag } })
      }
      case "/api/review/notes/targets":
        if (!accessTokens.has(bearer(request) ?? "")) return json({ error: "unauthorized" }, { status: 401 })
        return json({ targets: [{ id: "t1", name: "Example review", access: "team" }] })
      case "/api/review/notes/session": {
        if (!accessTokens.has(bearer(request) ?? "")) return json({ error: "unauthorized" }, { status: 401 })
        counts.session++
        const { origin, target } = JSON.parse(body!) as { origin: string; target?: string }
        const token = id("review")
        reviewTokens.set(token, { origin, ...(target ? { target } : {}) })
        issued.add(token)
        return json({ token, expires: Date.now() + options.sessionMs })
      }
    }
    if (url.pathname.startsWith("/api/review/")) {
      counts.review++
      const session = reviewTokens.get(bearer(request) ?? "")
      if (!session) return json({ error: "unauthorized" }, { status: 401 })
      if (url.pathname === "/api/review/presence")
        return json({ room: "room-1", ticket: "presence-ticket", you: { id: "user-1", name: "Example Reviewer" } })
      if (url.pathname.startsWith("/api/review/images/"))
        return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } })
      return json({ comments: [], origin: session.origin })
    }
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
    fetch: (input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init)),
    approve,
    counts,
    requests,
    options,
    clients,
    reviewTokens,
    /** Every token the Drop issued, for checking that none leaves the background. */
    secrets: () => [...issued],
    revokeAll: () => refreshTokens.clear(),
  }
}

export type FakeDrop = ReturnType<typeof createFakeDrop>

/** Links the extension to the fake Drop through the real code flow. */
export async function linkTo(fake: FakeDrop) {
  const oauth = await import("../lib/oauth")
  return oauth.link(DROP, { redirectUri: REDIRECT, launch: async (url) => fake.approve(url) })
}
