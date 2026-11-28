import type { McpOAuthOptions } from "vite-hub/auth/mcp"

export const NOTES_TOKEN_SECONDS = 300

export const notesResource = (origin: string) => `${origin}/api/review/notes`

export function dropOAuth(origin: string): McpOAuthOptions {
  const mcp = `${origin}/mcp`
  const notes = notesResource(origin)
  return {
    resource: [mcp, notes],
    loginPage: "/oauth",
    provider: {
      codeExpiresIn: 30 * 60,
      enforcePerClientResources: false,
      resources: [mcp, { identifier: notes, accessTokenTtl: NOTES_TOKEN_SECONDS }],
    },
  }
}
