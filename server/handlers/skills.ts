import { defineHandler, HTTPError } from "h3"
import { digest, findSkill, SKILLS, skillArchive } from "../utils/skills"

const V2 = "/.well-known/agent-skills/"
const V1 = "/.well-known/skills/"

const json = (body: unknown) => new Response(JSON.stringify(body, null, 2), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } })
const markdown = (text: string) => new Response(text, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600" } })

/**
 * Agent Skills Discovery. v0.2.0 (`/.well-known/agent-skills/`): an index with a `$schema`, and per skill a
 * `skill-md` (one file) or an `archive` (several), each with a sha256 digest. v0.1.0 (`/.well-known/skills/`):
 * the older index with a `files` list, which `npx skills add` reads.
 */
export default defineHandler(async (event) => {
  const { pathname } = event.url
  const v2 = pathname.startsWith(V2)
  const path = pathname.slice((v2 ? V2 : V1).length)

  if (path === "index.json") {
    if (!v2) return json({ skills: SKILLS.map(skill => ({ name: skill.name, description: skill.description, files: skill.files.map(file => file.path) })) })
    return json({
      $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
      skills: await Promise.all(SKILLS.map(async skill => skill.files.length === 1
        ? { name: skill.name, type: "skill-md", description: skill.description, url: `${V2}${skill.name}/SKILL.md`, digest: await digest(skill.files[0]!.bytes) }
        : { name: skill.name, type: "archive", description: skill.description, url: `${V2}${skill.name}.tar.gz`, digest: await digest(await skillArchive(skill)) })),
    })
  }

  const archive = v2 ? path.match(/^([a-z0-9-]+)\.tar\.gz$/)?.[1] : undefined
  if (archive) {
    const skill = findSkill(archive)
    if (skill) return new Response(await skillArchive(skill) as Uint8Array<ArrayBuffer>, { headers: { "content-type": "application/gzip", "cache-control": "public, max-age=3600" } })
  }

  const [name, ...rest] = path.split("/")
  const file = findSkill(name ?? "")?.files.find(item => item.path === rest.join("/"))
  if (file) return markdown(file.text)
  throw new HTTPError({ status: 404, statusText: "No such skill file." })
})
