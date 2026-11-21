import type { CommentSendAgent } from "vite-hub/comments/client"
import type { MemberEndpoint } from "vite-hub/webhooks"

const AGENTS = new Map<string, Pick<CommentSendAgent, "name" | "logo">>([
  ["t3", { name: "T3 Code", logo: "t3" }],
  ["claude-code", { name: "Claude Code", logo: "claude" }],
  ["codex", { name: "Codex", logo: "codex" }],
])

export function sendAgent(endpoint: Pick<MemberEndpoint, "agent" | "host" | "name">): CommentSendAgent {
  const known = endpoint.agent ? AGENTS.get(endpoint.agent) : undefined
  return { ...(known ?? { name: endpoint.name, logo: "t3" }), ...(endpoint.host ? { host: endpoint.host } : {}) }
}
