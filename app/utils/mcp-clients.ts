// How to add Drop's MCP server to each client. No keys to paste: each client signs in through the browser the
// first time and keeps the token itself. Used by the Agents page and the docs.
export type McpClient = "claude" | "codex" | "cursor" | "vscode" | "any"

export const MCP_CLIENTS: Record<McpClient, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", vscode: "VS Code", any: "Any client" }

export function mcpSnippets(server: string): Record<McpClient, string> {
  return {
    claude: `claude mcp add --transport http --scope user drop ${server}`,
    codex: `codex mcp add drop --url ${server}\ncodex mcp login drop`,
    cursor: `// ~/.cursor/mcp.json\n{\n  "mcpServers": {\n    "drop": { "url": "${server}" }\n  }\n}`,
    vscode: `// .vscode/mcp.json\n{\n  "servers": {\n    "drop": { "type": "http", "url": "${server}" }\n  }\n}`,
    any: `npx add-mcp ${server}`,
  }
}

export const MCP_HINTS: Record<McpClient, string> = {
  claude: "Then run /mcp in Claude Code and pick drop to sign in.",
  codex: "The login opens Drop in your browser.",
  cursor: "Cursor shows “Needs login” next to drop. Click it to sign in.",
  vscode: "VS Code asks to sign in the first time it starts the server.",
  any: "Your client opens Drop in the browser the first time it connects.",
}
