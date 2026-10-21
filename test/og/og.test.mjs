import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { calls, event, insertDrop, migrate, objects, reset, sql, state, who } from "../cost/harness.mjs"
const { default: ogHandler } = await import("../../server/routes/og/[id].get.ts")
const { default: detailHandler } = await import("../../server/api/drops/[id].get.ts")
const { dropExcerpt, ogCardHtml } = await import("../../server/utils/og.ts")
const { findDrop } = await import("../../server/utils/drops.ts")

migrate()
beforeEach(() => {
  reset()
  sql.exec("DELETE FROM drop_texts")
})

async function card(id) {
  const request = event(`/og/${id}`)
  request.context.params = { id }
  return ogHandler(request)
}

const text = (id, value) => sql.prepare("INSERT INTO drop_texts (drop_id, text) VALUES (?, ?)").run(id, value)

test("a public drop's card shows its title and first words, and renders once", async () => {
  insertDrop("loan", { visibility: "public", title: "Hipoteca de 80.000 €" })
  text("loan", "ING y CaixaBank, para devolverla en 2,5 a 3 años.")

  const first = await card("loan.png")
  assert.equal(first.headers.get("content-type"), "image/png")
  assert.equal(first.headers.get("cache-control"), "public, max-age=3600")
  assert.equal(await first.text(), "card")
  assert.equal(state.ogRenders.length, 1)
  assert.match(state.ogRenders[0].html, /<h1>Hipoteca de 80\.000 €<\/h1>/)
  assert.match(state.ogRenders[0].html, /<p>ING y CaixaBank, para devolverla en 2,5 a 3 años\.<\/p>/)
  assert.match(state.ogRenders[0].html, /src="https:\/\/drop\.example\/favicon\.svg"/)
  assert.equal(calls.writes.at(-1).options.ttl, 60 * 60 * 24 * 30)

  const again = await card("loan.png")
  assert.equal(again.headers.get("content-type"), "image/png")
  assert.equal(state.ogRenders.length, 1, "the cached card answers")

  sql.prepare("UPDATE drops SET title = 'Hipoteca, revisada' WHERE id = 'loan'").run()
  await card("loan.png")
  assert.equal(state.ogRenders.length, 2, "a renamed drop gets a new card")
})

test("anything a stranger can't open gets the generic card, the same as a missing drop", async () => {
  insertDrop("mine", { visibility: "private", title: "Salary plan" })
  insertDrop("team", { visibility: "team", title: "Team plan" })
  state.who = who
  for (const id of ["mine.png", "team.png", "gone.png", "mine", "../mine.png"]) {
    const response = await card(id)
    assert.equal(response.status, 302, id)
    assert.equal(response.headers.get("location"), "/og.png", id)
  }
  assert.equal(state.ogRenders.length, 0)
})

test("a host without Browser Run, or a caller past the render limit, gets the generic card", async () => {
  insertDrop("open", { visibility: "public" })
  state.ogBrowser = false
  assert.equal((await card("open.png")).headers.get("location"), "/og.png")
  assert.equal(calls.writes.length, 0)

  state.ogBrowser = true
  state.failBurst = true
  assert.equal((await card("open.png")).headers.get("location"), "/og.png")
  assert.equal(state.bursts.at(-1).bucket, "og-image")
})

test("the card escapes what the drop's owner wrote", () => {
  const html = ogCardHtml(
    { title: `<img src=x onerror="x">`, excerpt: "a & b", kind: "markdown", version: 2, date: 0 },
    "https://drop.example",
  )
  assert.doesNotMatch(html, /<img src=x/)
  assert.match(html, /&lt;img src=x onerror=&quot;x&quot;&gt;/)
  assert.match(html, /<p>a &amp; b<\/p>/)
  assert.match(html, /<span>Doc<\/span><span>v2<\/span>/)
})

test("excerpts end on a whole word and come from what each kind says", async () => {
  insertDrop("long", { visibility: "public" })
  const words = Array.from({ length: 80 }, (_, index) => `word${index}`).join(" ")
  text("long", words)
  const long = await dropExcerpt(await findDrop("long"))
  assert.ok(long.length <= 201)
  assert.match(long, /word\d+…$/)

  insertDrop("folder", { kind: "folder", blob_key: null, note: "Plans the agents file here." })
  assert.equal(await dropExcerpt(await findDrop("folder")), "Plans the agents file here.")

  insertDrop("image", { kind: "image", filename: "a.png", blob_key: "a.png" })
  assert.equal(await dropExcerpt(await findDrop("image")), undefined)
})

test("the drop page's detail carries the excerpt from the doc's own text", async () => {
  insertDrop("doc", { visibility: "public" })
  objects.set("doc.md", { body: new Blob(["# Title\n\nThe **first** words of the doc."]), uploadedAt: new Date() })
  const request = event("/api/drops/doc")
  request.context.params = { id: "doc" }
  const detail = await detailHandler(request)
  assert.equal(detail.excerpt, "The first words of the doc.")
})
