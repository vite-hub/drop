import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { REVIEW_SCRIPT, reviewScript } from "../../shared/review-script.ts"

test("the extension's review.js loads no code, keeps no token in the page, and opens no window", () => {
  const source = reviewScript({ host: "extension" })
  // MV3 runs no remote code, and Firefox's content scripts can't set adoptedStyleSheets.
  for (const banned of [
    "esm.sh",
    "import(",
    "sessionStorage",
    "window.open",
    "document.currentScript",
    "adoptedStyleSheets",
  ])
    assert.equal(source.includes(banned), false, banned)
  assert.equal(reviewScript({ host: "page" }), REVIEW_SCRIPT)
})
