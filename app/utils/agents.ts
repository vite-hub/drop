import { knownAgent } from "#shared/agents"

export function agentLogo(name: string): { icon?: string; color?: string; logo: string } | null {
  const agent = knownAgent(name)
  return agent ? { icon: agent.icon, color: agent.color, logo: agent.logo } : null
}
