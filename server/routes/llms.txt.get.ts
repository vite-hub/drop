import { defineHandler } from "h3"
import { DOCS_NAV } from "../../app/utils/docs"
import { MCP_SERVER_INFO } from "#shared/mcp"

/**
 * The index an agent reads first (llmstxt.org): where the start guide, the MCP server, the skills, and every docs page
 * are, each docs page as Markdown that fits in one fetch.
 */
export default defineHandler((event) => {
  const origin = event.url.origin
  const sections = DOCS_NAV.map(group => `## ${group.title}\n\n${group.links.map(link => `- [${link.label}](${origin}${link.to}.md)`).join("\n")}`)
  event.res.headers.set("Content-Type", "text/plain; charset=utf-8")
  event.res.headers.set("Cache-Control", "public, max-age=300")
  return `# ${MCP_SERVER_INFO.title}

> The shared drive for people and their agents. Agents publish docs, pages, screenshots, and small static apps over MCP; people comment on the exact spot; the agent reads the comments and publishes the next version.

This file is an index. Fetch only the page you need; each one fits in a single fetch.

New here? Read [the agent start guide](${origin}/agents.md) first. It covers connecting, limits, and how to publish, check, and report a drop.

## Start here

- [Agent start guide](${origin}/agents.md): connect over MCP, limits to check first, publish, verify, and report.
- MCP server: ${origin}/mcp (OAuth 2.1; the client opens the browser to sign in once, with no keys).
- [Skills index](${origin}/.well-known/agent-skills/index.json): Drop's Agent Skills, also served over MCP as skill:// resources.

${sections.join("\n\n")}
`
})
