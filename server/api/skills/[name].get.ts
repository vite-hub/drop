import { defineHandler, getValidatedRouterParams, HTTPError } from "h3"
import * as v from "valibot"
import type { SkillDetail } from "#shared/types"
import { requireIdentity } from "../../utils/identity"
import { renderMarkdownBody } from "../../utils/markdown-document"
import { disabledSkills, findSkill } from "../../utils/skills"

const Params = v.object({ name: v.pipe(v.string(), v.regex(/^[a-z0-9-]{1,64}$/)) })

/** One skill with every file, Markdown rendered for reading. A disabled skill is only visible to admins. */
export default defineHandler(async (event): Promise<SkillDetail> => {
  const who = await requireIdentity(event)
  const { name } = await getValidatedRouterParams(event, Params)
  const skill = findSkill(name)
  const enabled = !(await disabledSkills()).has(name)
  if (!skill || (!enabled && who.role !== "admin")) throw new HTTPError({ status: 404, statusText: "No skill with that name." })
  return {
    name: skill.name,
    description: skill.description,
    enabled,
    uri: `skill://${skill.name}/SKILL.md`,
    files: await Promise.all(skill.files.map(async file => ({
      path: file.path,
      text: file.text,
      size: file.bytes.byteLength,
      ...(file.path.endsWith(".md") ? { html: (await renderMarkdownBody(file.text)).html } : {}),
    }))),
  }
})
