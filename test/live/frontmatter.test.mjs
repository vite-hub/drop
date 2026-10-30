import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { editorlessSyntax, hasEditorlessSyntax, joinFrontmatter, splitFrontmatter } from "../../shared/frontmatter.ts"

test("the editor gets the body; publishing puts the front matter back without the old supersedes", () => {
  const source = "---\ntitle: Plan\nsupersedes: 3f1c7a52-0000-4000-8000-000000000000\n---\n\n# Plan\n\nText.\n"
  const { frontmatter, body } = splitFrontmatter(source)
  assert.equal(body, "# Plan\n\nText.\n")
  assert.equal(joinFrontmatter(frontmatter, "# Plan\n\nEdited.\n"), "---\ntitle: Plan\n---\n\n# Plan\n\nEdited.\n")
})

test("docs without front matter round-trip unchanged, and front matter left empty disappears", () => {
  assert.deepEqual(splitFrontmatter("# Plan\n"), { frontmatter: "", body: "# Plan\n" })
  assert.equal(joinFrontmatter("", "# Plan\n"), "# Plan\n")
  assert.equal(joinFrontmatter("---\nsupersedes: abc\n---\n", "# Plan\n"), "# Plan\n")
})

test("Comark block components and footnotes keep a doc out of the editor; colons and brackets in prose do not", () => {
  assert.equal(hasEditorlessSyntax("# Plan\n\n::callout\nHi\n::\n"), true)
  assert.equal(hasEditorlessSyntax("A claim.[^1]\n\n[^1]: The source.\n"), true)
  assert.equal(hasEditorlessSyntax("---\ntitle: a::b\n---\n\nTime 10::30 is fine.\n"), false)
  assert.equal(hasEditorlessSyntax("Exponents like x[^2] and [^ref] stay prose.\n"), false)
  assert.equal(hasEditorlessSyntax("Released :badge[New] today.\n"), true)
  assert.equal(hasEditorlessSyntax(':icon{name="lucide:rocket"} Launch\n'), true)
  assert.equal(hasEditorlessSyntax("Ship it{++ today++}.\n"), true)
  assert.equal(hasEditorlessSyntax("Note: see key:value, 10:30, and [the docs](https://drop.vitehub.dev).\n"), false)
})

test("a read-only doc names what keeps it out of the editor, once each, in reading order", () => {
  const doc =
    "::question\nWhy?\n::\n\nA claim.[^1] :badge[New] and ::question again.\n\n::poll\n::\n\n[^1]: Source.\n{++ more ++}\n"
  assert.deepEqual(editorlessSyntax(doc), ["::question", ":badge", "::poll", "footnotes", "suggested edits"])
  assert.deepEqual(editorlessSyntax("# Plain\n\nJust prose.\n"), [])
})
