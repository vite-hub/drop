import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import { H3 } from "h3"
import { vitehub } from "vite-hub"
import { afterEach, beforeEach, test } from "vite-plus/test"
import { migrate, reset, state } from "../cost/harness.mjs"

const { default: membersOnly } = await import("../../server/middleware/0.2.members-only.ts")
const app = new H3().use(membersOnly).all("/**", () => "reached the route")
const request = (path, method = "GET") =>
  app.fetch(
    new Request(`https://drop.quiver.dk${path}`, { method, headers: { origin: "https://pr1481.preview.quiver.dk" } }),
  )

migrate()
beforeEach(() => {
  reset()
  state.members = "github-org:acme"
})
afterEach(() => {
  state.members = ""
})

// review.js on a site sends no Drop session, only its review token, which each route checks (server/utils/review.ts).
test("a members-only Drop lets every review.js route through to its token check", async () => {
  for (const [method, path] of [
    ["OPTIONS", "/api/review/related"],
    ["GET", "/api/review/related"],
    ["OPTIONS", "/api/review/comments"],
    ["GET", "/api/review/comments"],
    ["POST", "/api/review/comments"],
    ["OPTIONS", "/api/review/comments/1"],
    ["PATCH", "/api/review/comments/1"],
    ["OPTIONS", "/api/review/comments/1/replies"],
    ["POST", "/api/review/comments/1/replies"],
    ["OPTIONS", "/api/review/images/abc"],
    ["GET", "/api/review/images/abc"],
  ]) {
    const response = await request(path, method)
    assert.equal(response.status, 200, `${method} ${path}`)
  }
})

test("the rest of /api/review still needs a member", async () => {
  for (const [method, path] of [
    ["POST", "/api/review/token"],
    ["POST", "/api/review/sites"],
    ["POST", "/api/review/open"],
    ["GET", "/api/review/related/x"],
    ["GET", "/api/review/comments/1/replies/x"],
  ]) {
    const response = await request(path, method)
    assert.equal(response.status, 401, `${method} ${path}`)
  }
})

// Like a public link's page, a folder's skills check the folder's share themselves (server/utils/hub-skills.ts).
test("a members-only Drop lets a folder's skill discovery through, and nothing else below a link", async () => {
  for (const path of [
    "/d/abc/skill-hub/.well-known/agent-skills/index.json",
    "/d/abc/.well-known/skills/release-notes/scripts/check.mjs",
  ])
    assert.equal((await request(path)).status, 200, path)
  for (const path of ["/d/abc/skill-hub/.well-known/other/index.json", "/d/abc/skill-hub/deeper/page"])
    assert.equal((await request(path)).status, 401, path)
})

// ViteHub serves Comments, Realtime and the Console's reads under /_vitehub, outside /api.
test("a members-only Drop gates ViteHub's data routes, and leaves its signed and static ones open", async () => {
  for (const path of [
    "/_vitehub/comments/threads",
    "/_vitehub/comments/auth/github",
    "/_vitehub/realtime/drafts/abc",
    "/_vitehub/console/status",
    "/api/_vitehub/comments/threads",
    "/api/_vitehub/realtime/drafts/abc",
  ])
    assert.equal((await request(path)).status, 401, path)
  for (const path of [
    "/_vitehub/comments/attachments/abc",
    "/api/_vitehub/comments/attachments/abc",
    "/_vitehub/realtime/latest/abc",
    "/_vitehub/realtime/presence/abc",
    "/api/_vitehub/realtime/presence/abc",
    "/_vitehub/rpc",
    "/_vitehub/comments/assets/overlay.js",
    "/_vitehub/console/assets/page-tool.js",
  ])
    assert.equal((await request(path)).status, 200, path)
})

test("a members-only Drop logs a signed-out reader's browser error", async () => {
  const plugins = [vitehub({ host: "node", observability: { browserErrors: true } })].flat(Infinity)
  const plugin = (await Promise.all(plugins)).flat(Infinity).find((entry) => entry?.name === "vite-hub/browser-errors")
  const config = {}
  plugin.config(config)
  const route = "/_vitehub/browser-errors"
  const registration = config.nitro.handlers.find((entry) => entry.route === route && entry.method === "POST")
  const { default: handler } = await import(pathToFileURL(registration.handler).href)
  const logged = []
  const receiver = new H3().use(membersOnly).post(route, (event) => {
    event.req.context.log = {
      set() {},
      warn() {},
      error: (error, fields) => logged.push({ message: error.message, ...fields }),
    }
    return handler.fetch(event.req)
  })
  const origin = "https://drop.quiver.dk"
  const response = await receiver.fetch(
    new Request(`${origin}${route}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ kind: "nuxt", path: "/d/abc/plan", message: "Could not open this page" }),
    }),
  )
  assert.equal(response.status, 204)
  assert.deepEqual(logged, [
    { message: "Could not open this page", browserError: { kind: "nuxt", path: "/d/abc/plan", level: "error" } },
  ])
})
