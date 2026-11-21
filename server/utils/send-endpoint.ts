import type { CommentSendAgent } from "vite-hub/comments/client"
import type { MemberEndpoint } from "vite-hub/webhooks"

/** The agents Send pairs, by the id ViteHub keeps on the endpoint, as the pill names them. */
const AGENTS = new Map<string, Pick<CommentSendAgent, "name" | "logo">>([
  ["t3", { name: "T3 Code", logo: "t3" }],
  ["claude-code", { name: "Claude Code", logo: "claude" }],
  ["codex", { name: "Codex", logo: "codex" }],
])

/** The member's Send agent as the Agents page shows it: its name and, for a URL, the host it posts to. */
export function sendAgent(endpoint: Pick<MemberEndpoint, "agent" | "host" | "name">): CommentSendAgent {
  const known = endpoint.agent ? AGENTS.get(endpoint.agent) : undefined
  return { ...(known ?? { name: endpoint.name, logo: "t3" }), ...(endpoint.host ? { host: endpoint.host } : {}) }
}
