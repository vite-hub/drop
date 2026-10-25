import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { test } from "vite-plus/test"
import { parseYAML } from "confbox/yaml"
import { createMarkdownParser } from "@comark/html/parse"
import comarkUi from "comark-ui/html"
import { migrate } from "../cost/harness.mjs"

migrate()

const root = new URL("../../skills/", import.meta.url)
const names = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

test("ships the built-in skills and Slidev's own", () => {
  assert.deepEqual(names.sort(), ["handoff", "pr-evidence", "prototype", "show-me", "slidev", "vitehub-drop"])
})

for (const name of names) {
  test(`${name}: frontmatter names the folder and describes when to use it`, async () => {
    const markdown = await readFile(new URL(`${name}/SKILL.md`, root), "utf8")
    const frontmatter = parseYAML(markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "")
    assert.equal(frontmatter.name, name)
    assert.match(frontmatter.name, /^[a-z0-9-]{1,64}$/)
    assert.ok(typeof frontmatter.description === "string" && frontmatter.description.length > 40)
    assert.match(frontmatter.description, /Use when/)
  })
}

test("pr-evidence serves the renderer's comark-ui skill and all its references", async () => {
  const { findSkill } = await import("../../server/utils/skills.ts")
  const files = findSkill("pr-evidence").files
  const upstream = new URL("../../node_modules/comark-ui/dist/skills/comark-ui/", import.meta.url)
  const skill = await readFile(new URL("SKILL.md", upstream), "utf8")
  assert.equal(files.find((item) => item.path === "references/comark-ui/SKILL.md").text, skill)
  const reference = files.find((item) => item.path === "references/annotations.md").text
  assert.match(reference, /^# comark-ui/)
  assert.match(reference, /::compare/)
  for (const name of await readdir(new URL("references/", upstream))) {
    assert.equal(
      files.find((item) => item.path === `references/comark-ui/references/${name}`).text,
      await readFile(new URL(`references/${name}`, upstream), "utf8"),
    )
  }
  for (const [, target] of reference.matchAll(/\]\((comark-ui\/[^)]+)\)/g)) {
    assert.ok(
      files.some((item) => item.path === `references/${target}`),
      `missing ${target}`,
    )
  }
})

test("show-me's annotated screenshot example is valid comark-ui", async () => {
  const skill = await readFile(new URL("show-me/SKILL.md", root), "utf8")
  const example = skill.match(/```md\n([\s\S]*?)\n```/)?.[1]
  assert.ok(example)
  const document = await createMarkdownParser({ plugins: comarkUi().plugins })(example)
  assert.deepEqual(document.meta.issues, [])
})
