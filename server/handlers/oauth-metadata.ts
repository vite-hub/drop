import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider"
import { defineHandler } from "h3"
import { MCP_SERVER_INFO } from "#shared/mcp"
import { mcpFor } from "../mcp"
import { authFor } from "../utils/identity"

/**
 * OAuth discovery for MCP clients, at the bare and path-suffixed well-known URLs they try:
 * RFC 9728 protected resource metadata for `/mcp`, then RFC 8414 / OpenID metadata for the issuer
 * (`<origin>/api/auth`, Better Auth's OAuth provider).
 */
export default defineHandler(async (event) => {
  const path = event.url.pathname
  if (path.startsWith("/.well-known/oauth-protected-resource")) {
    const response = mcpFor(event.url.origin).oauth.metadataHandler(event)
    if (response.status === 204) return response
    // Clients need Drop's display name before they have an access token.
    return Response.json({
      ...await response.json(),
      resource_name: MCP_SERVER_INFO.title,
      resource_documentation: `${event.url.origin}/docs/agents`,
    }, { headers: response.headers })
  }
  const auth = authFor(event)
  if (path.startsWith("/.well-known/openid-configuration")) return oauthProviderOpenIdConfigMetadata(auth)(event.req)
  return oauthProviderAuthServerMetadata(auth)(event.req)
})
