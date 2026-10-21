import { APIError, createAuthMiddleware } from "better-auth/api"
import { registrationProblem } from "#shared/oauth-registration"
import * as v from "valibot"
import { textValue } from "#shared/utils/text"

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])
const Registration = v.looseObject({ application_type: v.optional(v.unknown()), redirect_uris: v.array(v.unknown()) })

/** A redirect only an app on the user's own machine can receive: http on loopback, or a private-use scheme. */
function isNativeRedirect(input: unknown) {
  const uri = textValue(input)
  if (uri === undefined || !URL.canParse(uri)) return false
  const url = new URL(uri)
  return url.protocol === "http:" ? LOOPBACK.has(url.hostname) : url.protocol !== "https:"
}

/**
 * Anyone may register an MCP client, so registrations are bounded before Better Auth stores them. Whether a client is
 * native (loopback or private-use redirects, which Claude Code, Codex and Cursor send without `application_type`) is
 * the OAuth provider's `clientRegistrationDefaultApplicationType: "infer"` (server/auth.ts).
 */
export const clientRegistrationLimits = createAuthMiddleware(async (ctx) => {
  if (ctx.path.replace(/\/+$/, "") !== "/oauth2/register") return
  const problem = registrationProblem(ctx.body)
  if (problem) throw new APIError("BAD_REQUEST", { message: problem })

  const parsed = v.safeParse(Registration, ctx.body)
  if (!parsed.success || parsed.output.application_type || !parsed.output.redirect_uris.length) return
  const native = parsed.output.redirect_uris.every(isNativeRedirect)
  const mixed = !native && parsed.output.redirect_uris.some(isNativeRedirect)
  if (mixed) return { context: { body: { ...parsed.output, application_type: "web" } } }
})
