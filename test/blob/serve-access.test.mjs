import assert from "node:assert/strict"
import { H3 } from "h3"
import { beforeEach, test } from "vite-plus/test"
import { calls, insertDrop, migrate, objects, reset, state, who } from "../cost/harness.mjs"

const { authorize } = await import("../../server/blob.ts")
const { default: accessMiddleware } = await import("../../server/middleware/0.drop-access.ts")

migrate()
beforeEach(reset)

// ViteHub's generated serve route runs `authorize` with the H3 event, then serves the raw catch-all `params._`.
const serveRoute = (event) =>
  Promise.resolve(authorize({ event, request: event.req, session: null, user: null })).then((allowed) =>
    allowed === true ? state.blob.serve(event.req, event.context.params._) : new Response(null, { status: 403 }),
  )
const app = new H3()
  .use((event) => {
    event.context.log = { set() {}, error() {}, warn() {} }
  })
  .use(accessMiddleware)
  .all("/f/**", serveRoute)
  .all("/files/**", serveRoute)
const fetchFile = (path) => app.fetch(new Request(`https://drop.example${path}`, { headers: { accept: "image/*" } }))

test("a signed-out visitor gets a public drop's file", async () => {
  insertDrop("shot", { kind: "image", blob_key: "shot.png" })
  const response = await fetchFile("/f/shot.png")
  assert.equal(response.status, 200)
  assert.equal(await response.text(), "# Source")
  assert.equal(calls.serve, 1)
})

test("a signed-out visitor gets 404 for a private drop's file, before storage is read", async () => {
  insertDrop("secret", { kind: "image", blob_key: "secret.png", visibility: "private" })
  assert.equal((await fetchFile("/f/secret.png")).status, 404)
  assert.equal(calls.serve, 0)
})

test("the owner, and a member of a team drop, get the file; a signed-in stranger does not", async () => {
  insertDrop("secret", { kind: "image", blob_key: "secret.png", visibility: "private" })
  state.who = who
  assert.equal((await fetchFile("/f/secret.png")).status, 200)
  state.who = { ...who, userId: "stranger", email: "stranger@example.com" }
  assert.equal((await fetchFile("/f/secret.png")).status, 404)

  state.mode = "team"
  insertDrop("team", { kind: "image", blob_key: "team.png", visibility: "team" })
  state.who = { ...who, userId: "member", email: "member@example.com" }
  assert.equal((await fetchFile("/f/team.png")).status, 200)
  state.who = null
  assert.equal((await fetchFile("/f/team.png")).status, 404)
})

test("an encoded or renamed path checks the same key it serves", async () => {
  objects.set("apps/app/index.html", { body: new Blob(["<p>app</p>"]) })
  objects.set("drafts/owner/draft.md", { body: new Blob(["draft"]) })
  for (const path of [
    "/f/%61pps/app/index.html",
    "/f/%2Fapps/app/index.html",
    "/f//apps/app/index.html",
    "/f/apps%2Fapp%2Findex.html",
    "/f/%64rafts/owner/draft.md",
  ])
    assert.equal((await fetchFile(path)).status, 404, path)

  insertDrop("secret", { kind: "image", blob_key: "secret.png", visibility: "private" })
  for (const path of ["/f/%73ecret.png", "/f/secret%2Epng", "/f//secret.png", "/files/secret.png"])
    assert.equal((await fetchFile(path)).status, 404, path)
  state.who = who
  for (const path of ["/f/%73ecret.png", "/files/secret.png"]) assert.equal((await fetchFile(path)).status, 200, path)
  assert.equal(calls.serve, 2)
})
