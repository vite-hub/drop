import { defineHandler } from "h3"
import type { SkillSummary } from "#shared/types"
import { requireIdentity } from "../../utils/identity"
import { renderMarkdownBody } from "../../utils/markdown-document"
import { disabledSkills, SKILLS } from "../../utils/skills"

const SOURCE = "https://github.com/vite-hub/drop/blob/main/skills"

// Built-in skills never change while an isolate runs, so each renders once. The row shows the name already, so
// the document's own title goes.
const rendered = new Map<string, Promise<string>>()
function html(name: string, markdown: string) {
  let page = rendered.get(name)
  if (!page) {
    page = renderMarkdownBody(markdown).then(({ html }) => html.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>/, ""))
    rendered.set(name, page)
  }
  return page
}

/** The skills catalog: what agents get over MCP. Admins also see the ones they switched off. */
export default defineHandler(async (event): Promise<SkillSummary[]> => {
  const who = await requireIdentity(event)
  const disabled = await disabledSkills()
  return Promise.all(SKILLS
    .filter(skill => who.role === "admin" || !disabled.has(skill.name))
    .map(async skill => ({
      name: skill.name,
      description: skill.description,
      enabled: !disabled.has(skill.name),
      uri: `skill://${skill.name}/SKILL.md`,
      html: await html(skill.name, skill.files.find(file => file.path === "SKILL.md")!.text),
      source: `${SOURCE}/${skill.name}/SKILL.md`,
    })))
})
