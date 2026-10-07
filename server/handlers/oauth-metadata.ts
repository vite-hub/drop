import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider"
import { defineHandler } from "h3"
import { mcpFor } from "../mcp"
import { authFor } from "../utils/identity"

/**
 * OAuth discovery for MCP clients, at the bare and path-suffixed well-known URLs they try:
 * RFC 9728 protected resource metadata for `/mcp`, then RFC 8414 / OpenID metadata for the issuer
 * (`<origin>/api/auth`, Better Auth's OAuth provider).
 */
export default defineHandler((event) => {
  const path = event.url.pathname
  if (path.startsWith("/.well-known/oauth-protected-resource")) return mcpFor(event.url.origin).oauth.metadataHandler(event)
  const auth = authFor(event)
  if (path.startsWith("/.well-known/openid-configuration")) return oauthProviderOpenIdConfigMetadata(auth)(event.req)
  return oauthProviderAuthServerMetadata(auth)(event.req)
})
