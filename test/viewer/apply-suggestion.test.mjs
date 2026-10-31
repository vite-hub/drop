import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { applySuggestion } from "../../shared/suggestion.ts"

test("a suggestion's words replace its quote where the source has it, and say why when they can't", () => {
  assert.deepEqual(applySuggestion("Ship on *Friday*.", "Ship on", "Launch on", null), { body: "Launch on *Friday*." })
  assert.deepEqual(applySuggestion("one two\nthree", "two three", "2 3", null), { body: "one 2 3" })
  assert.deepEqual(applySuggestion("Keep this word here.", "word", "", null), { body: "Keep this here." })
  assert.deepEqual(applySuggestion("Drop it, now.", "it", "", null), { body: "Drop, now." })
  assert.match(applySuggestion("Ship on **Fri**day.", "Friday", "Monday", null).error, /aren't in the Markdown/)
  assert.match(applySuggestion("a cat\n\na cat", "cat", "dog", null).error, /more than once/)
  const twice = "## Plan\n\nThe cat sat.\n\n- The **cat** ran and the cat hid."
  assert.deepEqual(applySuggestion(twice, "cat", "dog", 'p "The cat sat."'), {
    body: "## Plan\n\nThe dog sat.\n\n- The **cat** ran and the cat hid.",
  })
  assert.match(applySuggestion(twice, "cat", "dog", 'li "The cat ran and the cat hid."').error, /more than once/)
  assert.deepEqual(applySuggestion("a $1.50 (b)", "$1.50 (b)", "c", null), { body: "a c" })
})
