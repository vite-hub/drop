import assert from "node:assert/strict"
import { H3 } from "h3"
import { test } from "vite-plus/test"
import { legacyViteHubRoutes } from "../../scripts/legacy-vitehub-routes.ts"

test("legacy attachment reads reach the Comments handler with the full path", async () => {
  const comments = { route: "/_vitehub/comments/**", handler: "comments", lazy: true }
  const options = { handlers: [comments] }
  await legacyViteHubRoutes({ options })
  const alias = options.handlers[1]
  assert.equal(alias.handler, comments.handler)
  assert.equal(alias.lazy, comments.lazy)
  assert.equal(alias.method, "GET")

  const app = new H3().get(alias.route, (event) => event.url.pathname)
  const base = "/api/_vitehub/comments"
  for (const key of ["drop-image-id", "comments/page/image-id/screen%20shot.png"]) {
    const path = `${base}/attachments/${key}`
    const response = await app.request(path)
    assert.equal(response.status, 200, path)
    assert.equal(await response.text(), path)
    assert.equal((await app.request(path, { method: "POST" })).status, 404)
  }
  assert.equal((await app.request(`${base}/threads/thread-id`)).status, 404)
})
