import { addTemplate, defineNuxtModule } from "nuxt/kit"
import { parseYAML } from "confbox/yaml"
import * as v from "valibot"

const BASE = "https://comark-ui.onmax.me/.well-known/skills/"
const Index = v.object({
  skills: v.pipe(
    v.array(
      v.object({
        name: v.pipe(v.string(), v.regex(/^[a-z0-9-]{1,64}$/)),
        description: v.string(),
        files: v.pipe(
          v.array(v.pipe(v.string(), v.regex(/^[\w-][\w.-]*(?:\/[\w-][\w.-]*)*$/))),
          v.check((paths) => paths.includes("SKILL.md") && new Set(paths).size === paths.length),
        ),
      }),
    ),
    v.minLength(1),
    v.check((skills) => new Set(skills.map((skill) => skill.name)).size === skills.length),
  ),
})

async function fetchText(path: string) {
  const response = await fetch(new URL(path, BASE), { signal: AbortSignal.timeout(10_000), redirect: "error" })
  if (!response.ok) throw new Error(`Comark UI skill ${path}: HTTP ${response.status}`)
  return response.text()
}

export async function loadComarkSkills() {
  const index = v.parse(Index, JSON.parse(await fetchText("index.json")))
  return Promise.all(
    index.skills.map(async (entry) => {
      const files: { path: string; text: string }[] = []
      for (let start = 0; start < entry.files.length; start += 4) {
        files.push(
          ...(await Promise.all(
            entry.files.slice(start, start + 4).map(async (path) => ({
              path,
              text: await fetchText(`${entry.name}/${path}`),
            })),
          )),
        )
      }
      const markdown = files.find((file) => file.path === "SKILL.md")!
      const block = markdown.text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ""
      const frontmatter = v.parse(v.object({ name: v.literal(entry.name), description: v.string() }), parseYAML(block))
      return {
        name: frontmatter.name,
        description: frontmatter.description,
        source: new URL(`${entry.name}/SKILL.md`, BASE).href,
        files,
      }
    }),
  )
}

export default defineNuxtModule({
  meta: { name: "drop-comark-skills" },
  async setup(_options, nuxt) {
    const skills = await loadComarkSkills()
    const template = addTemplate({
      filename: "comark-ui-skills.ts",
      write: true,
      getContents: () => `export default ${JSON.stringify(skills)}\n`,
    })
    nuxt.options.alias["#comark-ui-skills"] = template.dst
  },
})
