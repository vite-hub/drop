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
import settings from "../skills"

const skills = skillsMcp(settings.enabled)

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

async function read(uri: string) {
  const [error, result] = await skills.read(uri)
  if (error) throw new McpJsonRpcError(-32602, error.why, { status: 404, data: { uri } })
  return result
}

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
