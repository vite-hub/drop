import { createAuthMiddleware } from "better-auth/api"

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])

/** A redirect only an app on the user's own machine can receive: http on loopback, or a private-use scheme. */
function isNativeRedirect(uri: unknown) {
  if (typeof uri !== "string" || !URL.canParse(uri)) return false
  const url = new URL(uri)
  return url.protocol === "http:" ? LOOPBACK.has(url.hostname) : url.protocol !== "https:"
}

/**
 * MCP clients (Claude Code, Codex, Cursor…) register loopback redirects but often omit `application_type`,
 * which RFC 7591 defaults to "web", and web clients may only redirect to https. When every redirect is
 * native, register the client as the native app it is.
 */
export const nativeClientRegistration = createAuthMiddleware(async (ctx) => {
  const body = ctx.body as { application_type?: string; redirect_uris?: unknown[] } | undefined
  if (ctx.path !== "/oauth2/register" || !body || body.application_type || !body.redirect_uris?.length || !body.redirect_uris.every(isNativeRedirect)) return
  return { context: { body: { ...body, application_type: "native" } } }
})
