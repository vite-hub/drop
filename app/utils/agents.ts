import { knownAgent } from "#shared/agents"

/** The agent's mark for a key or actor name ("Claude Code", "codex cli"…), or null for unknown agents. */
export function agentLogo(name: string): { icon?: string; color?: string; logo: string } | null {
  const agent = knownAgent(name)
  return agent ? { icon: agent.icon, color: agent.color, logo: agent.logo } : null
}
