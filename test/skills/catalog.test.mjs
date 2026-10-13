import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { test } from "node:test"
import { parseYAML } from "confbox/yaml"
import { createMarkdownParser } from "@comark/html/parse"
import annotate from "comark-annotate"

const root = new URL("../../skills/", import.meta.url)
const names = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)

test("ships the three built-in skills", () => {
  assert.deepEqual(names.sort(), ["handoff", "pr-evidence", "vitehub-drop"])
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

test("pr-evidence's annotation example is valid comark-annotate", async () => {
  const reference = await readFile(new URL("pr-evidence/references/annotations.md", root), "utf8")
  const example = reference.match(/```md\n([\s\S]*?)\n```/)?.[1]
  assert.ok(example)
  const document = await createMarkdownParser({ plugins: [annotate()] })(example)
  assert.deepEqual(document.meta.annotateIssues, [])
})
