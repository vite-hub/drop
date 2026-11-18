import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { awaitingAnswer } from "../../app/utils/comment-threads.ts"
import { feedbackMarkdown, promptMarkdown } from "../../app/utils/feedback.ts"

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

const thread = (n, fields = {}) => ({
  n,
  kind: "page",
  selector: "",
  quote: null,
  suggestion: null,
  body: `Comment ${n}`,
  authorName: "Ada",
  agent: null,
  mine: true,
  version: 1,
  resolved: false,
  resolvedAt: null,
  attachments: [],
  replies: [],
  ...fields,
})
const reply = (fields) => ({
  body: "Done",
  authorName: "Bob",
  agent: null,
  mine: false,
  createdAt: 2,
  attachments: [],
  ...fields,
})

test("the prompt waits on open threads where the reader spoke last, not an agent writing for them", () => {
  const waiting = awaitingAnswer([
    thread(3),
    thread(1, { resolved: true, resolvedAt: 1 }),
    thread(2, { mine: false, replies: [reply({ mine: true, body: "Still off" })] }),
    thread(4, { replies: [reply({ body: "Fixed in v2" })] }),
    thread(5, { mine: false }),
    thread(6, { agent: { name: "Claude", image: null } }),
    thread(7, { resolved: true, resolvedAt: 1, replies: [reply({ mine: true, body: "Not yet" })] }),
  ])
  assert.deepEqual(
    waiting.map((comment) => comment.n),
    [2, 3, 7],
  )
})

test("the prompt counts the comments, quotes them, and names the MCP calls for the drop's kind", () => {
  const url = "https://drop.test/d/abc/plan"
  const doc = promptMarkdown({ id: "abc", kind: "markdown", title: "Plan", version: 2 }, url, [
    thread(1, { kind: "text", quote: "twelve", suggestion: "fifteen" }),
    thread(4, { body: "Shorter intro" }),
  ])
  assert.match(
    doc,
    /^I left 2 comments on "Plan" in Drop\. Resolve them\.\n\nhttps:\/\/drop\.test\/d\/abc\/plan\n\n1\. > twelve/,
  )
  assert.match(doc, /4\. The whole page\n {3}Shorter intro \(Ada, on v1\)/)
  assert.match(doc, /read_drop for drop abc/)
  assert.match(doc, /accept_suggestion/)
  assert.match(doc, /previous "abc".*resolves \[1, 4\]/)

  const site = promptMarkdown({ id: "s1", kind: "site", title: "Shop", version: 1 }, url, [thread(2)])
  assert.match(site, /^I left a comment on "Shop" in Drop\. Resolve it\./)
  assert.match(site, /Fix the site, then reply to each comment with what you changed and resolve: true\./)
  assert.doesNotMatch(site, /accept_suggestion|resolves \[/)
})
