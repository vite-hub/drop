// Known agents by the name their MCP client registers with ("Claude Code", "Claude Code (drop)", "Executor"…). Marks are
// the official ones from Simple Icons (via @iconify-json/simple-icons), brand colors only where the mark is colored.
// Each agent's logo is also a file in public/agents/: the avatar its comments show, the mark on a round tile.

export interface KnownAgent {
  key: string
  /** How a comment names it, beside the person it acts for: "Claude (Maxi)". */
  label: string
  /** The Iconify mark, when Simple Icons has one. */
  icon?: string
  color?: string
  /** The avatar, a file in public/agents/. */
  logo: string
  names: readonly string[]
}

const AGENTS: readonly KnownAgent[] = [
  {
    key: "claude",
    label: "Claude",
    icon: "i-simple-icons-claude",
    color: "#D97757",
    logo: "/agents/claude.svg",
    names: ["claude", "claude code", "anthropic"],
  },
  {
    key: "codex",
    label: "Codex",
    icon: "i-simple-icons-openai",
    logo: "/agents/codex.svg",
    names: ["codex", "openai"],
  },
  { key: "chatgpt", label: "ChatGPT", icon: "i-simple-icons-openai", logo: "/agents/codex.svg", names: ["chatgpt"] },
  { key: "cursor", label: "Cursor", icon: "i-simple-icons-cursor", logo: "/agents/cursor.svg", names: ["cursor"] },
  {
    key: "copilot",
    label: "Copilot",
    icon: "i-simple-icons-githubcopilot",
    logo: "/agents/copilot.svg",
    names: ["copilot", "github copilot"],
  },
  {
    key: "gemini",
    label: "Gemini",
    icon: "i-simple-icons-googlegemini",
    color: "#8E75B2",
    logo: "/agents/gemini.svg",
    names: ["gemini", "gemini cli"],
  },
  {
    key: "windsurf",
    label: "Windsurf",
    icon: "i-simple-icons-windsurf",
    logo: "/agents/windsurf.svg",
    names: ["windsurf"],
  },
  { key: "zed", label: "Zed", icon: "i-simple-icons-zedindustries", logo: "/agents/zed.svg", names: ["zed"] },
  {
    key: "opencode",
    label: "OpenCode",
    icon: "i-simple-icons-opencode",
    logo: "/agents/opencode.svg",
    names: ["opencode"],
  },
  {
    key: "github-actions",
    label: "GitHub Actions",
    icon: "i-simple-icons-githubactions",
    color: "#2088FF",
    logo: "/agents/github-actions.svg",
    names: ["github actions"],
  },
  // Executor's own mark (MIT, github.com/UsefulSoftwareCo/executor); Simple Icons has none.
  { key: "executor", label: "Executor", logo: "/agents/executor.png", names: ["executor", "executor cli"] },
]

/** The known agent for a key or a client's name ("Claude Code", "codex cli"…), or null. */
export function knownAgent(name: string): KnownAgent | null {
  const needle = name.trim().toLowerCase()
  return (
    AGENTS.find((agent) =>
      agent.names.some((candidate) => needle === candidate || needle.startsWith(`${candidate} `)),
    ) ?? null
  )
}

/** Who wrote a comment or a reply, as text: "Claude (Maxi)" for an agent's, else the author. */
export const writtenBy = (item: { authorName: string; agent?: { name: string } | null }) =>
  item.agent ? `${item.agent.name} (${item.authorName})` : item.authorName
