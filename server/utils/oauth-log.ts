import { getOAuthProviderApi, type OAuthOptions, type OAuthRefreshToken, type Scope } from "@better-auth/oauth-provider"
import type { BetterAuthPlugin } from "better-auth"
import { createAuthMiddleware, isAPIError } from "better-auth/api"
import type { RequestLogger } from "evlog"
import type { H3Event } from "h3"
import { authRequest, requestLog } from "./logs"

declare module "h3" {
  interface H3EventContext {
    oauthEndpoint?: string
    oauthRefresh?: RefreshSeen
  }
}

const LOGGED = ["/oauth2/token", "/oauth2/register", "/oauth2/authorize", "/oauth2/consent", "/oauth2/revoke"]
const GRANT_TYPES = new Set([
  "authorization_code",
  "refresh_token",
  "client_credentials",
  "urn:ietf:params:oauth:grant-type:device_code",
  "urn:ietf:params:oauth:grant-type:jwt-bearer",
  "urn:ietf:params:oauth:grant-type:token-exchange",
])
const OAUTH_ERRORS = new Set([
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
  "invalid_target",
  "invalid_token",
  "access_denied",
  "unsupported_response_type",
  "unsupported_token_type",
  "server_error",
  "temporarily_unavailable",
  "invalid_redirect_uri",
  "invalid_client_metadata",
  "invalid_software_statement",
  "unapproved_software_statement",
  "login_required",
  "consent_required",
  "interaction_required",
  "account_selection_required",
  "invalid_request_uri",
  "invalid_request_object",
  "invalid_dpop_proof",
  "use_dpop_nonce",
])
const BETTER_AUTH_CODE = /^[A-Z][A-Z_]{0,63}$/

type Context = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]
type Fields = Partial<Record<string, unknown>>
type RefreshSeen = {
  reason: "not_found" | "expired" | "client_mismatch" | "reused" | "ok"
  userId?: string
  clientId?: string
  tokenHash?: string
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined)
// SAFETY: every field read from the result is checked with `text`, so any object shape is fine.
const fields = (value: unknown): Fields => (value && typeof value === "object" ? (value as Fields) : {})
const grantTypeOf = (body: unknown) => {
  const grant = text(fields(body).grant_type)?.trim()
  return grant && (GRANT_TYPES.has(grant) ? grant : "other")
}
const errorCode = (value: unknown) => {
  const code = text(value)
  return code && (OAUTH_ERRORS.has(code) || BETTER_AUTH_CODE.test(code) ? code : "other")
}

function parseUrl(value: string, base?: string) {
  try {
    return new URL(value, base)
  } catch {
    return undefined
  }
}

function basicClientId(headers: Headers | undefined) {
  const basic = headers?.get("authorization")?.match(/^Basic +(\S+)$/i)?.[1]
  if (!basic) return
  const [id] = Buffer.from(basic, "base64").toString("utf8").split(":")
  try {
    return id ? decodeURIComponent(id.replaceAll("+", " ")) : undefined
  } catch {
    return undefined
  }
}

async function quietly(run: (log: RequestLogger, event: H3Event) => Promise<void> | void) {
  const event = authRequest.getStore()
  const log = requestLog(event)
  if (!event || !log) return
  try {
    await run(log, event)
  } catch (error) {
    log.set({ oauth: { logFailure: error instanceof Error ? error.name : typeof error } })
  }
}

function clientIdOf(ctx: Context, body: Fields, returned: unknown) {
  if (ctx.path === "/oauth2/authorize") return text(ctx.query?.client_id) ?? text(body.client_id)
  if (ctx.path === "/oauth2/consent") return text(new URLSearchParams(text(body.oauth_query)).get("client_id"))
  if (ctx.path === "/oauth2/register") return isAPIError(returned) ? undefined : text(fields(returned).client_id)
  return text(body.client_id) ?? basicClientId(ctx.headers)
}

function requestedCallback(ctx: Context, body: Fields) {
  if (ctx.path === "/oauth2/authorize") return text(ctx.query?.redirect_uri) ?? text(body.redirect_uri)
  if (ctx.path === "/oauth2/consent") return text(new URLSearchParams(text(body.oauth_query)).get("redirect_uri"))
}

function redirectOf(returned: unknown) {
  if (isAPIError(returned))
    return returned.statusCode < 400 ? text(new Headers(returned.headers).get("location")) : undefined
  const result = fields(returned)
  return result.redirect === true ? text(result.url) : undefined
}

const errorsIn = (url: URL) => [
  ...url.searchParams.getAll("error"),
  ...new URLSearchParams(url.hash.slice(1)).getAll("error"),
]

function redirectError(ctx: Context, body: Fields, returned: unknown) {
  const location = redirectOf(returned)
  const requested = requestedCallback(ctx, body)
  if (!location || !requested) return
  const callback = parseUrl(requested)
  const target = callback && parseUrl(location, callback.href)
  if (!callback || !target || target.origin !== callback.origin || target.pathname !== callback.pathname) return
  const added = errorsIn(target).slice(errorsIn(callback).length)
  return errorCode(added.at(-1))
}

async function seeRefresh(
  ctx: Context,
  presented: string,
  clientId: string | undefined,
): Promise<RefreshSeen | undefined> {
  // SAFETY: Better Auth returns the registered plugin object, and oauthProvider() keeps its options on `options`.
  const plugin = ctx.context.getPlugin("oauth-provider") as { options: OAuthOptions<Scope[]> } | null
  if (!plugin) return
  const opts = plugin.options
  const prefix = opts.prefix?.refreshToken
  if (prefix && !presented.startsWith(prefix)) return { reason: "not_found" }
  const unprefixed = prefix ? presented.slice(prefix.length) : presented
  const decoded = opts.formatRefreshToken?.decrypt ? await opts.formatRefreshToken.decrypt(unprefixed) : undefined
  const stored = await getOAuthProviderApi(ctx, opts).hashToken(decoded?.token ?? unprefixed, "refresh_token")
  const row = await ctx.context.adapter.findOne<OAuthRefreshToken>({
    model: "oauthRefreshToken",
    where: [{ field: "token", value: stored }],
  })
  const tokenHash = stored.slice(0, 12)
  if (!row) return { reason: "not_found", tokenHash }
  const reason =
    row.clientId !== clientId
      ? "client_mismatch"
      : row.expiresAt < new Date()
        ? "expired"
        : row.revoked
          ? "reused"
          : "ok"
  return { reason, userId: row.userId, clientId: row.clientId, tokenHash }
}

function refreshOutcome(seen: RefreshSeen, error: string | undefined) {
  if (!error) return { ...seen, reason: "ok" }
  if (error === "invalid_client") return { ...seen, reason: "invalid_client" }
  if (error !== "invalid_grant") return { ...seen, reason: "other" }
  return { ...seen, reason: seen.reason === "ok" ? "raced" : seen.reason }
}

export const oauthLog = () =>
  ({
    id: "drop-oauth-log",
    onRequest: async (request) => {
      await quietly((log, event) => {
        const path = new URL(request.url).pathname.replace(/\/+$/, "")
        const endpoint = LOGGED.find((candidate) => path.endsWith(candidate))
        if (!endpoint) return
        event.context.oauthEndpoint = endpoint
        log.set({ oauth: { endpoint } })
      })
    },
    onResponse: async (response) => {
      await quietly(async (log, event) => {
        if (!event.context.oauthEndpoint) return
        const json = response.status >= 400 && response.headers.get("content-type")?.includes("json")
        const body = json ? fields(await response.clone().json()) : {}
        const error = errorCode(text(body.error) ?? body.code)
        log.set({ oauth: { status: response.status, error } })
      })
    },
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/oauth2/token" && grantTypeOf(ctx.body) === "refresh_token",
          handler: createAuthMiddleware(async (ctx) => {
            await quietly(async (_log, event) => {
              const body = fields(ctx.body)
              const presented = text(body.refresh_token)
              if (!presented) return
              const clientId = text(body.client_id) ?? basicClientId(ctx.headers)
              event.context.oauthRefresh = await seeRefresh(ctx, presented, clientId)
            })
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => LOGGED.includes(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            await quietly((log, event) => {
              const body = fields(ctx.body)
              const returned = ctx.context.returned
              const failure = isAPIError(returned) && returned.statusCode >= 400 ? returned : undefined
              const seen = ctx.path === "/oauth2/token" ? event.context.oauthRefresh : undefined
              log.set({
                oauth: {
                  grantType: ctx.path === "/oauth2/token" ? grantTypeOf(body) : undefined,
                  clientId: clientIdOf(ctx, body, returned),
                  error: failure ? undefined : redirectError(ctx, body, returned),
                  refresh: seen && refreshOutcome(seen, failure && (errorCode(fields(failure.body).error) ?? "other")),
                },
              })
            })
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin
