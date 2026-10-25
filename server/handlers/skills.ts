import { defineHandler, HTTPError } from "h3"
import { digest, enabledSkills, findEnabledSkill, type Skill, type SkillFile, skillArchive } from "../utils/skills"

const V2 = "/.well-known/agent-skills/"
const V1 = "/.well-known/skills/"

const json = (body: unknown) =>
  new Response(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
  })
// What the v0.2.0 entry's digest covers: the file itself, or the archive of a multi-file skill.
const skillDigest = async (skill: Skill) =>
  digest(skill.files.length === 1 ? skill.files[0]!.bytes : await skillArchive(skill))

const text = (file: SkillFile) =>
  new Response(file.text, {
    headers: { "content-type": `${file.mimeType}; charset=utf-8`, "cache-control": "public, max-age=60" },
  })

/**
 * Agent Skills Discovery. v0.2.0 (`/.well-known/agent-skills/`): an index with a `$schema`, and per skill a
 * `skill-md` (one file) or an `archive` (several), each with a sha256 digest. v0.1.0 (`/.well-known/skills/`):
 * the older index with a `files` list and a `version`, which `npx skills add` and Executor read. Only enabled skills appear, and the short
 * cache lets an admin's toggle reach clients within a minute.
 */
export default defineHandler(async (event) => {
  const { pathname } = event.url
  const v2 = pathname.startsWith(V2)
  const path = pathname.slice((v2 ? V2 : V1).length)

  if (path === "index.json") {
    const SKILLS = await enabledSkills()
    // `version` changes whenever a skill's files do, so a client such as Executor reloads the files only then.
    if (!v2)
      return json({
        skills: await Promise.all(
          SKILLS.map(async (skill) => ({
            name: skill.name,
            description: skill.description,
            version: (await skillDigest(skill)).slice("sha256:".length, "sha256:".length + 12),
            files: skill.files.map((file) => file.path),
          })),
        ),
      })
    return json({
      $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
      skills: await Promise.all(
        SKILLS.map(async (skill) =>
          skill.files.length === 1
            ? {
                name: skill.name,
                type: "skill-md",
                description: skill.description,
                url: `${V2}${skill.name}/SKILL.md`,
                digest: await skillDigest(skill),
              }
            : {
                name: skill.name,
                type: "archive",
                description: skill.description,
                url: `${V2}${skill.name}.tar.gz`,
                digest: await skillDigest(skill),
              },
        ),
      ),
    })
  }

  const archive = v2 ? path.match(/^([a-z0-9-]+)\.tar\.gz$/)?.[1] : undefined
  if (archive) {
    const skill = await findEnabledSkill(archive)
    if (skill)
      return new Response(await skillArchive(skill), {
        headers: { "content-type": "application/gzip", "cache-control": "public, max-age=60" },
      })
  }

  const [name, ...rest] = path.split("/")
  const file = (await findEnabledSkill(name ?? ""))?.files.find((item) => item.path === rest.join("/"))
  if (file) return text(file)
  throw new HTTPError({ status: 404, statusText: "No such skill file." })
})
