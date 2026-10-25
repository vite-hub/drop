import {
  type ExtensionPlugin,
  invalidParamsError,
  McpJsonRpcError,
  mcpMethod,
  parseParams,
  requireParamString,
} from "h3-mcp"
import { defineMcpResource } from "nitro-mcp-toolkit"
import { digest, enabledSkills, findEnabledSkill, type Skill } from "./skills"

/**
 * The MCP Skills extension (SEP-2640, `io.modelcontextprotocol/skills`): `skills/list` and `skills/get` describe
 * each enabled skill (frontmatter plus every file with its digest), and the files themselves are resources
 * under `skill://<name>/<path>`, read with `resources/read`. h3-mcp has no skills support, so this is an
 * extension plugin; it only exists on the 2026-07-28 revision, as extensions do.
 *
 * Admins can switch a skill off, so nothing here is static: every call reads the enabled set, and a disabled
 * skill is missing from lists and unreadable. The cache hint matches how long other isolates may keep serving
 * the old set (see `disabledSkills`).
 */
const EXTENSION = "io.modelcontextprotocol/skills"
const CACHE = { ttlMs: 60_000, cacheScope: "public" } as const

const uriOf = (skill: Skill, path: string) => `skill://${skill.name}/${path}`

async function entry(skill: Skill) {
  return {
    uri: uriOf(skill, "SKILL.md"),
    frontmatter: skill.frontmatter,
    resources: await Promise.all(
      skill.files.map(async (file) => ({
        uri: uriOf(skill, file.path),
        digest: await digest(file.bytes),
        size: file.bytes.byteLength,
      })),
    ),
  }
}

export function mcpSkills(): ExtensionPlugin {
  return {
    id: EXTENSION,
    settings: () => ({ directoryRead: false }),
    methods: (ctx) => ({
      "skills/list": (req, event) =>
        mcpMethod(ctx, req, event, async () => ({
          resultType: "complete",
          skills: await Promise.all((await enabledSkills()).map(entry)),
          ...CACHE,
        })),
      "skills/get": (req, event) =>
        mcpMethod(ctx, req, event, async () => {
          const uri = requireParamString(parseParams(req.params), "uri")
          const name = uri.match(/^skill:\/\/([^/]+)(?:\/SKILL\.md)?$/)?.[1]
          const skill = name && (await findEnabledSkill(name))
          if (!skill) throw invalidParamsError(`No skill at ${uri}.`)
          return { resultType: "complete", skill: await entry(skill), ...CACHE }
        }),
    }),
  }
}

// `-32602` is what the 2026-07-28 revision answers for a resource that doesn't exist (clients still accept the older
// `-32002`); a disabled skill's files read the same way.
async function read(name: string, path: string) {
  const file = (await findEnabledSkill(name))?.files.find((item) => item.path === path)
  if (!file)
    throw new McpJsonRpcError(-32602, `No skill file at skill://${name}/${path}.`, {
      status: 404,
      data: { uri: `skill://${name}/${path}` },
    })
  return { contents: [{ uri: `skill://${name}/${path}`, mimeType: file.mimeType, text: file.text }] }
}

/**
 * Skill files as `skill://` resources. URI template variables can't span a `/`, so one template matches
 * top-level files and others match the bundled reference folders; the first lists every enabled file.
 */
export const skillResources = [
  defineMcpResource({
    name: "skill-file",
    title: "Skill file",
    description: "A file of one of Drop's enabled Agent Skills.",
    uriTemplate: "skill://{name}/{file}",
    list: async () =>
      (await enabledSkills()).flatMap((skill) =>
        skill.files.map((file) => ({
          uri: uriOf(skill, file.path),
          name: `${skill.name}/${file.path}`,
          title: file.path === "SKILL.md" ? `${skill.name} skill` : `${skill.name}: ${file.path}`,
          ...(file.path === "SKILL.md" ? { description: skill.description } : {}),
          mimeType: file.mimeType,
          size: file.bytes.byteLength,
        })),
      ),
    handler: (_uri, { name, file }) => read(name!, file!),
  }),
  defineMcpResource({
    name: "skill-reference",
    title: "Skill reference",
    description: "A file in a folder of one of Drop's enabled Agent Skills, such as references/ or assets/.",
    uriTemplate: "skill://{name}/{dir}/{file}",
    handler: (_uri, { name, dir, file }) => read(name!, `${dir}/${file}`),
  }),
  ...[2, 3].map((depth) =>
    defineMcpResource({
      name: `skill-reference-${depth}`,
      title: "Bundled skill reference",
      description: "A file in a bundled upstream skill's reference tree.",
      uriTemplate: `skill://{name}/${Array.from({ length: depth }, (_, index) => `{dir${index}}`).join("/")}/{file}`,
      handler: (_uri, params) =>
        read(params.name!, [...Array.from({ length: depth }, (_, index) => params[`dir${index}`]), params.file].join("/")),
    }),
  ),
]
