// Official agent marks from Simple Icons (via @iconify-json/simple-icons). Brand colors only where the mark is colored.
const AGENTS = [
  { icon: "i-simple-icons-claude", color: "#D97757", names: ["claude", "claude code", "anthropic"] },
  { icon: "i-simple-icons-openai", names: ["codex", "openai", "chatgpt"] },
  { icon: "i-simple-icons-cursor", names: ["cursor"] },
  { icon: "i-simple-icons-githubcopilot", names: ["copilot", "github copilot"] },
  { icon: "i-simple-icons-googlegemini", color: "#8E75B2", names: ["gemini", "gemini cli"] },
  { icon: "i-simple-icons-windsurf", names: ["windsurf"] },
  { icon: "i-simple-icons-zedindustries", names: ["zed"] },
  { icon: "i-simple-icons-opencode", names: ["opencode"] },
  { icon: "i-simple-icons-githubactions", color: "#2088FF", names: ["github actions"] },
] as const

/** The agent's mark for a key or actor name ("Claude Code", "codex cli"…), or null for unknown agents. */
export function agentLogo(name: string): { icon: string; color?: string } | null {
  const needle = name.trim().toLowerCase()
  return AGENTS.find(agent => agent.names.some(candidate => needle === candidate || needle.startsWith(`${candidate} `))) ?? null
}

