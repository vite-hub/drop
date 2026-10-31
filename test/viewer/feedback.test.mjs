import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { feedbackMarkdown } from "../../app/utils/feedback.ts"

test("copied image-only feedback includes fetchable comment and reply images", () => {
  const output = feedbackMarkdown(
    "Chart",
    "https://drop.test/d/chart",
    [
      {
        n: 1,
        kind: "area",
        selector: "#chart",
        ox: 0,
        oy: 0,
        ow: 500,
        oh: 500,
        body: "",
        authorName: "Ada",
        version: 1,
        resolved: false,
        attachments: [{ url: "/api/images/marked" }],
        replies: [{ body: "This arrow", authorName: "Bob", attachments: [{ url: "https://cdn.test/reply.webp" }] }],
      },
      {
        n: 2,
        kind: "page",
        body: "Resolved",
        authorName: "Ada",
        version: 1,
        resolved: true,
        attachments: [{ url: "/api/images/resolved" }],
        replies: [],
      },
    ],
    1,
  )
  assert.match(output, /\(no words, only the image\)/)
  assert.match(output, /Images: https:\/\/drop\.test\/api\/images\/marked/)
  assert.match(output, /↳ Bob: This arrow\n     Images: https:\/\/cdn\.test\/reply\.webp/)
  assert.doesNotMatch(output, /images\/resolved/)
})

test("copied feedback says what a suggestion replaces the quote with, or that it deletes it", () => {
  const comment = (n, suggestion, body = "") => ({
    n,
    kind: "text",
    selector: "p",
    quote: "twelve",
    suggestion,
    body,
    authorName: "Ada",
    version: 1,
    resolved: false,
    attachments: [],
    replies: [],
  })
  const output = feedbackMarkdown(
    "Plan",
    "https://drop.test/d/plan",
    [comment(1, "fifteen", "The count changed."), comment(2, ""), comment(3, null, "Plain")],
    1,
  )
  assert.match(output, /1\. > twelve\n {3}Suggests replacing it with: fifteen\n {3}The count changed\. \(Ada\)/)
  assert.match(output, /2\. > twelve\n {3}Suggests deleting it\.\n {3}\(no note\) \(Ada\)/)
  assert.match(output, /3\. > twelve\n {3}Plain \(Ada\)/)
})
