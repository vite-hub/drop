import { APIError } from "better-auth/api"
import { registrationProblem } from "#shared/oauth-registration"
import { createAuthMiddleware } from "better-auth/api"
import * as v from "valibot"
import { textValue } from "#shared/utils/text"

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])

/** A redirect only an app on the user's own machine can receive: http on loopback, or a private-use scheme. */
function isNativeRedirect(input: unknown) {
  const uri = textValue(input)
  if (uri === undefined || !URL.canParse(uri)) return false
  const url = new URL(uri)
  return url.protocol === "http:" ? LOOPBACK.has(url.hostname) : url.protocol !== "https:"
}

// What decides a native registration; registrationProblem has bounded the rest, and the other fields pass through.
const Registration = v.looseObject({ application_type: v.optional(v.unknown()), redirect_uris: v.array(v.unknown()) })

/**
 * MCP clients (Claude Code, Codex, Cursor…) register loopback redirects but often omit `application_type`,
 * which RFC 7591 defaults to "web", and web clients may only redirect to https. When every redirect is
 * native, register the client as the native app it is.
 */
export const nativeClientRegistration = createAuthMiddleware(async (ctx) => {
  const path = ctx.path.replace(/\/+$/, "")
  if (path === "/oauth2/register") {
    const problem = registrationProblem(ctx.body)
    if (problem) throw new APIError("BAD_REQUEST", { message: problem })
  }
  if (path !== "/oauth2/register") return
  const parsed = v.safeParse(Registration, ctx.body)
  if (!parsed.success) return
  const body = parsed.output
  if (body.application_type || !body.redirect_uris.length || !body.redirect_uris.every(isNativeRedirect)) return
  return { context: { body: { ...body, application_type: "native" } } }
})
