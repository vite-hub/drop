import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { formatElementReference } from "../../shared/element-reference.ts"

const comment = (fields) => ({
  kind: "area",
  selector: "",
  quote: null,
  label: null,
  ox: 0,
  oy: 0,
  ow: 0,
  oh: 0,
  page: null,
  ...fields,
})

test("an element reference gives the element, its selector, where in it, and the page's URL when the comment has them", () => {
  assert.equal(
    formatElementReference(
      comment({
        selector: "main > section.rsvp > button",
        label: 'button "RSVP"',
        ox: 100,
        oy: 200,
        ow: 300,
        oh: 150,
        quote: "RSVP",
        page: "https://example.com/meetups/vue",
      }),
    ),
    '[button "RSVP" selector: `main > section.rsvp > button`]\nArea: 10%–40% across, 20%–35% down\n> RSVP\nURL: https://example.com/meetups/vue',
  )
  assert.equal(
    formatElementReference(comment({ kind: "image", selector: "img", ox: 400, oy: 300, page: "/about" })),
    "[an image selector: `img`]\nSpot: 40% across, 30% down\nPage: /about",
  )
  assert.equal(formatElementReference(comment({ kind: "page" })), "[the whole page]")
})
