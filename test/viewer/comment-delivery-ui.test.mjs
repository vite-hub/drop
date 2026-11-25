import assert from "node:assert/strict"
import { CommentThread } from "vite-hub/ui"
import { test } from "vite-plus/test"
import { createSSRApp, h } from "vue"
import { renderToString } from "vue/server-renderer"

test("the Send-compatible UI renders offline delivery for both the comment and its replies", async () => {
  const author = { id: "ada", name: "Ada" }
  const delivery = (status) => ({ status, requestId: status, files: [] })
  const message = (body, delivery) => ({
    id: body,
    threadId: "thread",
    body,
    author,
    mentions: [],
    attachments: [],
    createdAt: 1,
    delivery,
  })
  const messages = [message("First", delivery("pending")), message("Reply", delivery("failed")), message("Sent")]
  const thread = {
    id: "thread",
    n: 0,
    author,
    anchor: { kind: "page" },
    messages,
    delivery: messages[0].delivery,
    status: "open",
  }
  const app = createSSRApp(() =>
    h(
      CommentThread,
      { thread, readOnly: true },
      {
        body: ({ message }) => h("p", message.body),
        status: ({ message, delivery }) => h("span", `${message.body}: ${delivery.status}`),
      },
    ),
  )
  app.component("UButton", () => h("button"))
  const html = await renderToString(app)
  // A waiting thread has no number yet: ViteHub titles it "Comment", and the status slot says why.
  assert.match(html, /<section aria-label="Comment" data-pending="true"/)
  assert.doesNotMatch(html, /Comment 0/)
  assert.match(html, /data-pending="true"[^]*?<p>First<\/p>[^]*?First: pending/)
  assert.match(html, /data-failed="true"[^]*?<p>Reply<\/p>[^]*?Reply: failed/)
  assert.match(html, /<p>Sent<\/p>/)
  assert.doesNotMatch(html, /Sent:/)
})
