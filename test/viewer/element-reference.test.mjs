import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { formatElementReference, siteReviewElement } from "../../shared/element-reference.ts"

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

test("a site comment from review.js points at its element, not at its screenshot", () => {
  const onShot = comment({
    kind: "image",
    selector: "body > img",
    label: "main > button",
    quote: 'button "RSVP"',
    ox: 400,
    oy: 300,
    page: "/meetups",
  })
  assert.equal(
    formatElementReference(siteReviewElement(onShot)),
    '[button "RSVP" selector: `main > button`]\nSpot: 40% across, 30% down\nPage: /meetups',
  )
})

test("a site screenshot with no element keeps its area and page but names no selector", () => {
  const blank = comment({ kind: "image", selector: "body > img", ox: 100, oy: 200, ow: 300, oh: 150, page: "/" })
  assert.equal(
    formatElementReference(siteReviewElement(blank)),
    "[an image]\nArea: 10%–40% across, 20%–35% down\nPage: /",
  )
})

test("a comment left in Drop's viewer on a site keeps its own selector and quote", () => {
  const anchored = comment({ kind: "text", selector: "main > p", label: "p", quote: "twelve" })
  assert.equal(siteReviewElement(anchored), anchored)
})
