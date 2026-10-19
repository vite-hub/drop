import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { hasBlockComponents, joinFrontmatter, splitFrontmatter } from "../../shared/frontmatter.ts"

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

test("Comark block components keep a doc out of the editor; prose that mentions colons does not", () => {
  assert.equal(hasBlockComponents("# Plan\n\n::callout\nHi\n::\n"), true)
  assert.equal(hasBlockComponents("---\ntitle: a::b\n---\n\nTime 10::30 is fine.\n"), false)
})
