import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { parseSearch, toggleFolder, toggleKind } from "../../app/utils/search-query.ts"

test("a search reads its words, one folder, and kinds by name or by a word for them", () => {
  assert.deepEqual(parseSearch('roadmap in:"Card Mailer (cards)" kind:image,doc  q3'), {
    words: "roadmap q3",
    folder: "Card Mailer (cards)",
    kinds: ["image", "markdown"],
  })
  assert.deepEqual(parseSearch("in:Launch kind:nope kind:pages"), { words: "", folder: "Launch", kinds: ["html"] })
  assert.deepEqual(parseSearch('in:"Half typed'), { words: "", folder: "Half typed", kinds: [] })
  assert.deepEqual(
    parseSearch("login:me"),
    { words: "login:me", folder: undefined, kinds: [] },
    "only whole qualifiers",
  )
})

test("the filter chips write and take out the same words", () => {
  assert.equal(toggleKind("plan", "image"), "plan kind:image ")
  assert.equal(toggleKind("plan kind:image ", "image"), "plan ")
  assert.equal(toggleKind("kind:images,doc plan", "image"), "kind:doc plan")
  assert.equal(toggleFolder("plan", "Card Mailer"), 'in:"Card Mailer" plan')
  assert.equal(toggleFolder('in:"Card Mailer" plan', "Card Mailer"), "plan")
  assert.equal(toggleFolder("", "Launch"), "in:Launch ")
})
