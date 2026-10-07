import { type ExtensionPlugin, invalidParamsError, mcpMethod, parseParams, requireParamString } from "h3-mcp"
import { defineMcpResource } from "nitro-mcp-toolkit"
import { digest, type Skill, SKILLS } from "./skills"

/**
 * The MCP Skills extension (SEP-2640, `io.modelcontextprotocol/skills`): `skills/list` and `skills/get` describe
 * each skill (frontmatter plus every file with its digest), and the files themselves are ordinary resources
 * under `skill://<name>/<path>`, read with `resources/read`. h3-mcp has no skills support, so this is an
 * extension plugin; it only exists on the 2026-07-28 revision, as extensions do.
 */
const EXTENSION = "io.modelcontextprotocol/skills"
const CACHE = { ttlMs: 300_000, cacheScope: "public" } as const

const uriOf = (skill: Skill, path: string) => `skill://${skill.name}/${path}`

async function entry(skill: Skill) {
  return {
    uri: uriOf(skill, "SKILL.md"),
    frontmatter: skill.frontmatter,
    resources: await Promise.all(skill.files.map(async file => ({ uri: uriOf(skill, file.path), digest: await digest(file.bytes), size: file.bytes.byteLength }))),
  }
}

export function mcpSkills(): ExtensionPlugin {
  return {
    id: EXTENSION,
    settings: () => ({ directoryRead: false }),
    methods: ctx => ({
      "skills/list": (req, event) => mcpMethod(ctx, req, event, async () => ({ resultType: "complete", skills: await Promise.all(SKILLS.map(entry)), ...CACHE })),
      "skills/get": (req, event) => mcpMethod(ctx, req, event, async () => {
        const uri = requireParamString(parseParams(req.params), "uri")
        const skill = SKILLS.find(item => uri === uriOf(item, "SKILL.md") || uri === `skill://${item.name}`)
        if (!skill) throw invalidParamsError(`No skill at ${uri}.`)
        return { resultType: "complete", skill: await entry(skill), ...CACHE }
      }),
    }),
  }
}

/** Every skill file as a `skill://` resource, so `resources/read` can fetch what `skills/get` lists. */
export const skillResources = SKILLS.flatMap(skill => skill.files.map(file => defineMcpResource({
  name: `${skill.name}/${file.path}`,
  title: file.path === "SKILL.md" ? `${skill.name} skill` : `${skill.name}: ${file.path}`,
  description: file.path === "SKILL.md" ? skill.description : undefined,
  uri: uriOf(skill, file.path),
  mimeType: file.mimeType,
  handler: () => file.text,
})))
