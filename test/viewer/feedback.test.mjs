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
