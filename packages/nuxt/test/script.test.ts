import { describe, expect, it } from "vitest"

import { reviewScript } from "../src/runtime/script.ts"

describe("reviewScript", () => {
  it("loads review.js from Drop's address", () => {
    expect(reviewScript({ url: "https://drop.example.com" })).toEqual({
      src: "https://drop.example.com/review.js",
      data: {},
    })
    expect(reviewScript({ url: "https://example.com/drop" })?.src).toBe("https://example.com/drop/review.js")
  })

  it("passes the toolbar's start place", () => {
    expect(reviewScript({ url: "https://drop.example.com", edge: "right", at: 100, collapsed: true })?.data).toEqual({
      edge: "right",
      at: "100",
      collapsed: "",
    })
    expect(reviewScript({ url: "https://drop.example.com", edge: "middle", at: -1 })?.data).toEqual({})
  })

  it.each([undefined, {}, { url: "" }, { url: "drop.example.com" }, { url: "javascript:alert(1)" }])(
    "loads nothing for %j",
    (config) => {
      expect(reviewScript(config)).toBeUndefined()
    },
  )
})
