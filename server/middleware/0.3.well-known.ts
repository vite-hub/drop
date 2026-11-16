import { defineHandler } from "h3"

/**
 * Public discovery documents at the origin root. Agent Skills Discovery: v0.2.0 at /.well-known/agent-skills/ and
 * v0.1.0 at /.well-known/skills/, which `npx skills add` reads, serving only the skills an admin left on. OAuth for MCP
 * clients: protected resource metadata for /mcp (RFC 9728) and the issuer's metadata (RFC 8414, OpenID) for Better
 * Auth at /api/auth. A public folder's link serves the skills it holds the same way, under
 * `/d/<link>/<slug>/.well-known/` (../utils/hub-skills.ts). Every other path passes through.
 */
export default defineHandler(async (event) => {
  const { pathname } = event.url
  // Loaded lazily: middleware lands in the Worker's entry module, which may only export handlers.
  if (pathname.startsWith("/d/") && pathname.includes("/.well-known/"))
    return (await import("../utils/hub-skills")).serveHubSkills(event)
  if (!pathname.startsWith("/.well-known/")) return
  const [{ serveSkills }, { enabledSkills }, { serveMcpOAuthDiscovery }, { MCP_SERVER_INFO }] = await Promise.all([
    import("vite-hub/skills"),
    import("../utils/skills"),
    import("vite-hub/auth/mcp"),
    import("#shared/mcp"),
  ])
  return (
    (await serveSkills(event.req, enabledSkills)) ??
    serveMcpOAuthDiscovery(event.req, {
      resourceName: MCP_SERVER_INFO.title,
      resourceDocumentation: `${event.url.origin}/docs/agents`,
    })
  )
})
