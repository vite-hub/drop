import {
  type ExtensionPlugin,
  invalidParamsError,
  McpJsonRpcError,
  mcpMethod,
  parseParams,
  requireParamString,
} from "h3-mcp"
import { defineMcpResource } from "nitro-mcp-toolkit"
import { skillsMcp } from "vite-hub/skills"
import { enabledSkills } from "./skills"

/**
 * The MCP Skills extension (SEP-2640, `io.modelcontextprotocol/skills`) on h3-mcp, which has no skills support: an
 * extension plugin for `skills/list` and `skills/get`, and `skill://` resources for the files. `skillsMcp` reads the
 * enabled set on every call, so a skill an admin switched off is missing from lists and unreadable.
 */
const skills = skillsMcp(enabledSkills)

export function mcpSkills(): ExtensionPlugin {
  return {
    id: skills.extension,
    settings: () => ({ directoryRead: false }),
    methods: (ctx) => ({
      "skills/list": (req, event) => mcpMethod(ctx, req, event, () => skills.list()),
      "skills/get": (req, event) =>
        mcpMethod(ctx, req, event, async () => {
          const uri = requireParamString(parseParams(req.params), "uri")
          const [error, result] = await skills.get(uri)
          if (error) throw invalidParamsError(error.why)
          return result
        }),
    }),
  }
}

// `-32602` is what the 2026-07-28 revision answers for a resource that doesn't exist (clients still accept the older
// `-32002`); a disabled skill's files read the same way.
async function read(uri: string) {
  const [error, result] = await skills.read(uri)
  if (error) throw new McpJsonRpcError(-32602, error.why, { status: 404, data: { uri } })
  return result
}

/**
 * Skill files as `skill://` resources. URI template variables can't span a `/`, so one template matches top-level
 * files and others match the folders below them; the first lists every enabled file.
 */
export const skillResources = [1, 2, 3, 4].map((depth) =>
  defineMcpResource({
    name: depth === 1 ? "skill-file" : `skill-file-${depth}`,
    title: "Skill file",
    description:
      "A file of one of Drop's enabled Agent Skills, at the top of the skill or in a folder such as references/.",
    uriTemplate: `skill://{name}/${Array.from({ length: depth }, (_, index) => `{p${index}}`).join("/")}`,
    ...(depth === 1 ? { list: () => skills.resources() } : {}),
    handler: (uri) => read(String(uri)),
  }),
)
