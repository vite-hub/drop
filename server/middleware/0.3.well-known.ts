import { defineHandler } from "h3"

export default defineHandler(async (event) => {
  const { pathname } = event.url
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
