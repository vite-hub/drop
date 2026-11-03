import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { matchPeople, mentionParts, mentionQuery } from "../../app/utils/mentions.ts"

const people = [
  { id: "1", name: "Ada Lovelace", image: null },
  { id: "2", name: "Álvaro Núñez", image: null },
  { id: "3", name: "Grace Hopper", image: null },
]

test("the @ at the caret opens a query, with spaces for full names", () => {
  assert.deepEqual(mentionQuery("Hi @ad", 6), { start: 3, query: "ad" })
  assert.deepEqual(mentionQuery("@Ada Lo", 7), { start: 0, query: "Ada Lo" })
  assert.deepEqual(mentionQuery("(@", 2), { start: 1, query: "" })
  assert.equal(mentionQuery("me@mail", 7), undefined)
  assert.equal(mentionQuery("@ ada", 5), undefined)
  assert.equal(mentionQuery("@ada\nnext", 9), undefined)
})

test("people match on the start of their name, then of a later word, ignoring accents", () => {
  assert.deepEqual(
    matchPeople(people, "alv").map((person) => person.id),
    ["2"],
  )
  assert.deepEqual(
    matchPeople(people, "h").map((person) => person.id),
    ["3"],
  )
  assert.deepEqual(
    matchPeople(people, "").map((person) => person.id),
    ["1", "2", "3"],
  )
  assert.deepEqual(matchPeople(people, "Ada Lovelace "), [])
})

test("posted text marks only whole names of known people", () => {
  assert.deepEqual(mentionParts("Thanks @Ada Lovelace, and @Bob.", ["Ada Lovelace", "Ada"]), [
    { text: "Thanks " },
    { text: "@Ada Lovelace", mention: "Ada Lovelace" },
    { text: ", and @Bob." },
  ])
  assert.deepEqual(mentionParts("mail ada@Ada.com @Adam", ["Ada"]), [{ text: "mail ada@Ada.com @Adam" }])
})
