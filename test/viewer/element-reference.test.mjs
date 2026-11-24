import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { formatElementReference, formatSiteElementReference } from "../../shared/element-reference.ts"

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
    formatSiteElementReference(onShot),
    '[button "RSVP" selector: `main > button`]\nSpot: 40% across, 30% down the screenshot\nPage: /meetups',
  )
})

test("a site screenshot with no element keeps its area and page but names no selector", () => {
  const blank = comment({ kind: "image", selector: "body > img", ox: 100, oy: 200, ow: 300, oh: 150, page: "/" })
  assert.equal(
    formatSiteElementReference(blank),
    "[an image]\nArea: 10%–40% across, 20%–35% down the screenshot\nPage: /",
  )
  assert.equal(
    formatSiteElementReference(comment({ selector: "body", page: "https://example.com/" })),
    "[an element]\nSpot: 0% across, 0% down the viewport\nURL: https://example.com/",
  )
})

test("a comment left in Drop's viewer on a site keeps its own selector and quote", () => {
  const anchored = comment({ kind: "text", selector: "main > p", label: "p", quote: "twelve" })
  assert.equal(formatSiteElementReference(anchored), formatElementReference(anchored))
  const onScreenshot = comment({ kind: "image", selector: "body > img", ox: 10, oy: 10 })
  assert.equal(formatSiteElementReference(onScreenshot), formatElementReference(onScreenshot))
})
