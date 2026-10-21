import { APIError, createAuthMiddleware } from "better-auth/api"
import { registrationProblem } from "#shared/oauth-registration"

/**
 * Anyone may register an MCP client, so registrations are bounded before Better Auth stores them. Whether a client is
 * native (loopback or private-use redirects, which Claude Code, Codex and Cursor send without `application_type`) is
 * the OAuth provider's `clientRegistrationDefaultApplicationType: "infer"` (server/auth.ts).
 */
export const clientRegistrationLimits = createAuthMiddleware(async (ctx) => {
  if (ctx.path.replace(/\/+$/, "") !== "/oauth2/register") return
  const problem = registrationProblem(ctx.body)
  if (problem) throw new APIError("BAD_REQUEST", { message: problem })
})
