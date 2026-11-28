import { browser } from "wxt/browser"
import { hold, release } from "./secrets"
import { local, session, type Access, type Link } from "./storage"

export const SCOPE = "openid profile email offline_access"
const EARLY = 30_000

export const notesResource = (drop: string) => `${drop}/api/review/notes`

export class LinkError extends Error {}
export class Unlinked extends LinkError {}

interface Discovery {
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
  revocation_endpoint?: string
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  id_token?: string
}

const unlinkListeners = new Set<() => void>()
export function onUnlink(listener: () => void) {
  unlinkListeners.add(listener)
}

async function discover(drop: string): Promise<Discovery> {
  const response = await fetch(`${drop}/.well-known/oauth-authorization-server`).catch(() => undefined)
  if (!response?.ok) throw new LinkError("This Drop doesn't offer sign-in for apps.")
  // SAFETY: RFC 8414 metadata; the fields used are checked below.
  const metadata = (await response.json()) as Partial<Discovery>
  if (!metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.registration_endpoint)
    throw new LinkError("This Drop doesn't let apps register for sign-in.")
  // SAFETY: the three required endpoints are present.
  return metadata as Discovery
}

async function client(drop: string, discovery: Discovery, redirectUri: string) {
  const clients = (await local.get("clients")) ?? {}
  const known = clients[drop]
  if (known?.redirectUri === redirectUri) return known.clientId
  const response = await fetch(discovery.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Drop browser extension",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  }).catch(() => undefined)
  if (!response?.ok) throw new LinkError("This Drop didn't register the extension.")
  // SAFETY: an RFC 7591 registration response.
  const { client_id: clientId } = (await response.json()) as { client_id?: string }
  if (!clientId) throw new LinkError("This Drop didn't register the extension.")
  await local.set("clients", { ...clients, [drop]: { clientId, redirectUri } })
  return clientId
}

async function forgetClient(drop: string) {
  const { [drop]: _gone, ...rest } = (await local.get("clients")) ?? {}
  await local.set("clients", rest)
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")

export async function pkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))
  return { verifier, challenge }
}

function account(idToken: string | undefined) {
  if (!idToken) return {}
  try {
    const payload = idToken.split(".")[1]!.replaceAll("-", "+").replaceAll("_", "/")
    const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))
    // SAFETY: an OIDC id_token payload; only its string claims are kept.
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
    return {
      ...(typeof claims.name === "string" ? { name: claims.name } : {}),
      ...(typeof claims.email === "string" ? { email: claims.email } : {}),
    }
  } catch {
    return {}
  }
}

async function postToken(endpoint: string, form: Record<string, string>) {
  return fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form),
  })
}

async function save(drop: string, clientId: string, tokens: TokenResponse, previous?: Link) {
  const refreshToken = tokens.refresh_token ?? previous?.refreshToken
  if (!tokens.access_token || !refreshToken)
    throw new LinkError("This Drop didn't return a token the extension can keep.")
  const saved: Link = {
    drop,
    clientId,
    refreshToken,
    ...(previous?.name ? { name: previous.name } : {}),
    ...(previous?.email ? { email: previous.email } : {}),
    ...account(tokens.id_token),
  }
  const access: Access = { drop, token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 }
  hold(access.token, saved.refreshToken)
  await local.set("link", saved)
  await session.set("access", access)
  return { ...saved, access }
}

export interface LinkDeps {
  launch: (url: string) => Promise<string | undefined>
  redirectUri: string
}

const browserLink = (): LinkDeps => ({
  launch: (url) => browser.identity.launchWebAuthFlow({ url, interactive: true }),
  redirectUri: browser.identity.getRedirectURL(),
})

export async function link(drop: string, deps: LinkDeps = browserLink()) {
  const discovery = await discover(drop)
  const clientId = await client(drop, discovery, deps.redirectUri)
  const { verifier, challenge } = await pkce()
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)))
  const url = new URL(discovery.authorization_endpoint)
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: deps.redirectUri,
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: notesResource(drop),
  }).toString()

  const returned = await deps.launch(url.href).catch((error: unknown) => {
    throw new LinkError(error instanceof Error ? error.message : "Sign-in closed.")
  })
  if (!returned) throw new LinkError("Sign-in closed.")
  const back = new URL(returned)
  if (back.searchParams.get("state") !== state) throw new LinkError("Sign-in came back for a different request.")
  const error = back.searchParams.get("error")
  if (error === "invalid_client") await forgetClient(drop)
  if (error) throw new LinkError(back.searchParams.get("error_description") ?? error)
  const code = back.searchParams.get("code")
  if (!code) throw new LinkError("Sign-in came back without a code.")

  const response = await postToken(discovery.token_endpoint, {
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: deps.redirectUri,
    resource: notesResource(drop),
  }).catch(() => undefined)
  if (!response) throw new LinkError("Couldn't reach the Drop.")
  // SAFETY: an OAuth token or error response.
  const body = (await response.json().catch(() => ({}))) as TokenResponse & { error?: string }
  if (body.error === "invalid_client") await forgetClient(drop)
  if (!response.ok) throw new LinkError(body.error ?? `The Drop answered ${response.status}.`)
  return save(drop, clientId, body)
}

type Saved = Awaited<ReturnType<typeof save>>

let refreshing: Promise<Saved> | undefined

export function refresh(): Promise<Saved> {
  refreshing ??= renew().finally(() => {
    refreshing = undefined
  })
  return refreshing
}

async function renew() {
  const current = await local.get("link")
  if (!current) throw new Unlinked("Not linked.")
  const discovery = await discover(current.drop)
  const response = await postToken(discovery.token_endpoint, {
    grant_type: "refresh_token",
    client_id: current.clientId,
    refresh_token: current.refreshToken,
    resource: notesResource(current.drop),
  }).catch(() => undefined)
  if (!response || response.status >= 500)
    throw new LinkError("Couldn't reach the Drop. The link is kept; try again later.")
  if (!response.ok) {
    await unlink({ revoke: false })
    throw new Unlinked("The Drop ended this link. Connect again.")
  }
  // SAFETY: an OAuth token response.
  return save(current.drop, current.clientId, (await response.json()) as TokenResponse, current)
}

export async function accessToken(): Promise<string> {
  const current = await local.get("link")
  if (!current) throw new Unlinked("Not linked.")
  const access = await session.get("access")
  hold(access?.token, current.refreshToken)
  if (access?.drop === current.drop && access.expiresAt - EARLY > Date.now()) return access.token
  return (await refresh()).access.token
}

export async function linked() {
  return local.get("link")
}

export async function unlink({ revoke = true } = {}) {
  const current = await local.get("link")
  const access = await session.get("access")
  await local.remove("link")
  await session.remove("access")
  for (const listener of unlinkListeners) listener()
  if (!current) return
  release(access?.token, current.refreshToken)
  if (!revoke) return
  try {
    const { revocation_endpoint: endpoint } = await discover(current.drop)
    if (endpoint)
      await postToken(endpoint, {
        token: current.refreshToken,
        token_type_hint: "refresh_token",
        client_id: current.clientId,
      })
  } catch {}
}
