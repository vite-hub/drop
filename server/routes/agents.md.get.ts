import { defineHandler } from "h3"
import { planLimits } from "#shared/quotas"
import { quotaConfig } from "../utils/quotas"
import dropMd from "../../skills/vitehub-drop/SKILL.md?raw"

const MIB = 1024 * 1024

/**
 * The agent start guide at a stable URL: how to connect, this deployment's limits, then the vitehub-drop skill, so an
 * agent without Drop's MCP server or skills yet has one page to read.
 */
export default defineHandler((event) => {
  const origin = event.url.origin
  const config = quotaConfig()
  const limits = planLimits(config.enabled ? config.defaultPlan : "unlimited", config.pro)
  const owner = config.enabled
    ? `- Each account holds at most ${limits.drops} drops and ${Math.round(limits.bytes! / MIB)} MiB, and writes at most ${limits.writes} files a month. Trash doesn't take a drop slot. \`list_drops\` shows usage.`
    : "- This Drop sets no per-account limits."
  const skill = dropMd
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    .replace(/^# .+\n/m, "")
    .replace(/\]\(references\//g, `](${origin}/.well-known/skills/vitehub-drop/references/`)
    .replaceAll("https://drop.vitehub.dev", origin)
  event.res.headers.set("Content-Type", "text/markdown; charset=utf-8")
  event.res.headers.set("Cache-Control", "public, max-age=300")
  return `# Drop agent instructions

Drop is a shared drive for people and their agents. You publish docs, pages, screenshots, and small static apps; people comment on the exact spot; you read the comments and publish the next version. The rest of the docs are indexed at ${origin}/llms.txt.

## Connect

Drop's MCP server is \`${origin}/mcp\`. For Claude Code:

\`\`\`sh
claude mcp add --transport http --scope user drop ${origin}/mcp
\`\`\`

The first call opens Drop in the user's browser to sign in; there is no key to ask for. Other clients: ${origin}/docs/agents.md

## Limits to check first

- An app is static files only: HTML, CSS, JavaScript, JSON, images. There is no server code or database; load libraries from a CDN.
- An app holds at most ${limits.appFiles} files and ${Math.round((limits.appBytes / MIB) * 10) / 10} MiB. A doc or file holds at most 4 MiB.
${owner}
- At most 30 publishes a minute. That limit is the only one worth waiting out: the error says how many seconds.
- Drops start private and expire by their lifetime unless it's \`keep\`.

${skill.trim()}
`
})
