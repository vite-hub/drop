import { parseYAML } from "confbox/yaml"
import { createTarGzip } from "nanotar"
import documentsGuide from "../../skills/vitehub-drop/references/documents.md?raw"
import skillMd from "../../skills/vitehub-drop/SKILL.md?raw"

/**
 * Drop's Agent Skills, defined once (the files under skills/) and served three ways:
 * - MCP: the Skills extension (SEP-2640), as `skill://` resources (server/mcp, server/utils/mcp-skills.ts)
 * - Agent Skills Discovery v0.2.0 at /.well-known/agent-skills/ (index with digests, archive for multi-file skills)
 * - Discovery v0.1.0 at /.well-known/skills/, which `npx skills add` still reads
 */
export interface SkillFile { path: string; text: string; bytes: Uint8Array; mimeType: string }
export interface Skill { name: string; description: string; frontmatter: Record<string, unknown>; files: SkillFile[] }

const encoder = new TextEncoder()
const file = (path: string, text: string): SkillFile => ({ path, text, bytes: encoder.encode(text), mimeType: "text/markdown" })

function frontmatterOf(markdown: string): Record<string, unknown> {
  const block = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
  return block ? parseYAML<Record<string, unknown>>(block) ?? {} : {}
}

function skill(files: SkillFile[]): Skill {
  const frontmatter = frontmatterOf(files.find(item => item.path === "SKILL.md")!.text)
  return { name: String(frontmatter.name), description: String(frontmatter.description), frontmatter, files }
}

export const SKILLS: Skill[] = [
  skill([file("SKILL.md", skillMd), file("references/documents.md", documentsGuide)]),
]

export const findSkill = (name: string) => SKILLS.find(item => item.name === name)

/** `sha256:<hex>`, the digest format both the MCP Skills extension and Discovery v0.2.0 use. */
export async function digest(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))
  return `sha256:${Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("")}`
}

/**
 * A multi-file skill as one .tar.gz (Discovery v0.2.0 `archive`). Fixed mtimes keep the bytes, and so the
 * digest, the same on every isolate; built once per isolate.
 */
const archives = new Map<string, Promise<Uint8Array>>()
export function skillArchive(item: Skill) {
  let archive = archives.get(item.name)
  if (!archive) {
    archive = createTarGzip(item.files.map(entry => ({ name: `${item.name}/${entry.path}`, data: entry.bytes, attrs: { mtime: 0, mode: "644" } })))
    archives.set(item.name, archive)
  }
  return archive
}
