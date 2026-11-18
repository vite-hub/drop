import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { awaitingAnswer, needsLook } from "../../app/utils/comment-threads.ts"
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
  const resolvedWithFollowUp = thread(7, {
    resolved: true,
    resolvedAt: 1,
    replies: [reply({ mine: true, body: "Not yet" })],
  })
  assert.equal(needsLook(resolvedWithFollowUp), true)
  const waiting = awaitingAnswer([
    thread(3),
    thread(1, { resolved: true, resolvedAt: 1 }),
    thread(2, { mine: false, replies: [reply({ mine: true, body: "Still off" })] }),
    thread(4, { replies: [reply({ body: "Fixed in v2" })] }),
    thread(5, { mine: false }),
    thread(6, { agent: { name: "Claude", image: null } }),
    resolvedWithFollowUp,
  ])
  assert.deepEqual(
    waiting.map((comment) => comment.n),
    [2, 3],
  )
})

test("the prompt counts the comments, quotes them, and names the MCP calls for the drop's kind", () => {
  const url = "https://drop.test/d/abc/plan"
  const doc = promptMarkdown({ id: "abc", kind: "markdown", title: "Plan", version: 2, isOwner: true }, url, [
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
  assert.match(doc, /Only if edits are still needed, publish.*previous "abc"/)
  assert.match(doc, /resolves only the still-open comments addressed by that publish from \[1, 4\]/)
})

test("accepting the only suggestion does not call for another publish", () => {
  const doc = promptMarkdown(
    { id: "abc", kind: "markdown", title: "Plan", version: 2, isOwner: true },
    "https://drop.test/d/abc",
    [thread(1, { kind: "text", quote: "twelve", suggestion: "fifteen" })],
  )
  assert.match(doc, /accept_suggestion.*publishes and resolves/)
  assert.match(doc, /If nothing remains, do not publish again/)
})

test("the copied site prompt includes the screenshot and element box even with a quote", () => {
  const site = promptMarkdown(
    { id: "s1", kind: "site", title: "Shop", version: 1, isOwner: false },
    "https://drop.test/d/s1",
    [
      thread(2, {
        id: "site-thread",
        kind: "image",
        selector: "body > img",
        label: ".price",
        quote: "$10",
        page: "https://shop.test/cart",
        ox: 100,
        oy: 200,
        ow: 400,
        oh: 100,
      }),
      thread(3, { id: "small-box", kind: "image", ox: 100, oy: 200, ow: 3, oh: 4 }),
    ],
    new Map([
      ["site-thread", { url: "/f/screen.png" }],
      ["small-box", { url: "/f/small-box.png" }],
    ]),
  )
  assert.match(site, /2\. > \$10 \(https:\/\/shop\.test\/cart\)/)
  assert.match(site, /Element `\.price`/)
  assert.match(site, /Box 10%–50% across, 20%–30% down the screenshot/)
  assert.match(site, /Box 10%–10\.3% across, 20%–20\.4% down the screenshot/)
  assert.match(site, /Screenshot: https:\/\/drop\.test\/f\/screen\.png/)
  assert.match(site, /reply.*resolve: true.*if authorized/)
  assert.doesNotMatch(site, /accept_suggestion|previous /)
})

test("link updates are in place rather than publishing a version", () => {
  const url = "https://drop.test/d/abc"
  const drop = { id: "abc", title: "Plan", version: 1 }
  const link = promptMarkdown({ ...drop, kind: "link", isOwner: true }, url, [thread(1)])
  assert.match(link, /update_drop.*url/)
  assert.match(link, /reply/)
  assert.doesNotMatch(link, /previous /)
})

test("reviewers get a handoff without write access", () => {
  const url = "https://drop.test/d/abc"
  const drop = { id: "abc", title: "Plan", version: 1 }
  for (const kind of ["markdown", "board", "link"]) {
    const prompt = promptMarkdown({ ...drop, kind, isOwner: false }, url, [thread(1, { suggestion: "fifteen" })])
    assert.match(prompt, /prepare the proposed changes for me to review/)
    assert.match(prompt, /reply without requesting resolution/)
    assert.doesNotMatch(prompt, /accept_suggestion|edit_board|update_drop|previous |resolve: true/)
  }
  const board = promptMarkdown({ ...drop, kind: "board", isOwner: true }, url, [thread(1)])
  assert.match(board, /edit_board.*reply.*resolve: true/)
})
