import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { test } from "vite-plus/test"
import { parseYAML } from "confbox/yaml"
import { createMarkdownParser } from "@comark/html/parse"
import annotate from "comark-annotate"
import { migrate } from "../cost/harness.mjs"

migrate()

const root = new URL("../../skills/", import.meta.url)
const names = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

test("ships the five built-in skills", () => {
  assert.deepEqual(names.sort(), ["handoff", "pr-evidence", "prototype", "show-me", "vitehub-drop"])
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

test("pr-evidence serves comark-annotate's skill, without its front matter and with the CLI pinned", async () => {
  const { findSkill } = await import("../../server/utils/skills.ts")
  const { version } = JSON.parse(await readFile(new URL("../../node_modules/comark-annotate/package.json", import.meta.url), "utf8"))
  const reference = findSkill("pr-evidence").files.find((item) => item.path === "references/annotations.md").text
  assert.match(reference, /^# /)
  assert.match(reference, /::compare/)
  assert.ok(reference.includes(`npx comark-annotate@${version} check`))
  assert.ok(!/npx comark-annotate /.test(reference))
})

test("show-me's annotated screenshot example is valid comark-annotate", async () => {
  const skill = await readFile(new URL("show-me/SKILL.md", root), "utf8")
  const example = skill.match(/```md\n([\s\S]*?)\n```/)?.[1]
  assert.ok(example)
  const document = await createMarkdownParser({ plugins: [annotate()] })(example)
  assert.deepEqual(document.meta.issues, [])
})
