import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { sql, state, event, migrate, reset, insertDrop, who, queries } from "../cost/harness.mjs"

const { listPinned, setPinned, dropDetail, findDrop } = await import("../../server/utils/drops.ts")

migrate()
const mate = { ...who, userId: "mate", name: "Mate", email: "mate@example.com", actorName: "Mate" }
beforeEach(() => {
  reset()
  sql.prepare("INSERT INTO user (id, name, email) VALUES ('mate', 'Mate', 'mate@example.com')").run()
})
const titles = async (person) => (await listPinned(person)).map((drop) => drop.title)

test("many pinned folders under distinct parents fit in a fixed D1 query budget", async () => {
  const pin = sql.prepare("INSERT INTO drop_pins (user_id, drop_id, at) VALUES (?, ?, ?)")
  for (let index = 0; index < 2250; index++) {
    const parent = `parent-${index}`
    const folder = `folder-${index}`
    insertDrop(parent, { kind: "folder" })
    insertDrop(folder, { kind: "folder", parent_id: parent })
    pin.run(who.userId, folder, index)
  }
  insertDrop("child", { parent_id: "folder-0" })
  queries.length = 0
  const pinned = await listPinned(who)
  assert.ok(queries.length <= 3, `Pinned used ${queries.length} queries`)
  assert.equal(pinned.length, 2250)
  assert.equal(pinned[0].id, "folder-2249")
  assert.equal(pinned.at(-1).id, "folder-0")
  assert.equal(pinned.at(-1).path[0].id, "parent-0")
  assert.equal(pinned.at(-1).items, 1)
})

test("pins list newest pin first, yours and others' you can open, and say whose they are", async () => {
  insertDrop("mine")
  insertDrop("theirs", { owner_id: "mate", visibility: "public" })
  await setPinned("theirs", who, true)
  await new Promise((resolve) => setTimeout(resolve, 2))
  await setPinned("mine", who, true)
  const list = await listPinned(who)
  assert.deepEqual(
    list.map((drop) => drop.title),
    ["mine", "theirs"],
  )
  assert.equal(list[0].owner, undefined)
  assert.equal(list[1].owner.name, "Mate")
  assert.ok(list.every((drop) => drop.pinned))
  // Pins are personal.
  assert.deepEqual(await titles(mate), [])
})

test("pinning twice keeps one pin, and unpinning removes it", async () => {
  insertDrop("doc")
  await setPinned("doc", who, true)
  await setPinned("doc", who, true)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM drop_pins").get().n, 1)
  await setPinned("doc", who, false)
  assert.deepEqual(await titles(who), [])
})

test("a pin hides while its drop is in the Trash or no longer shared with you, and comes back after", async () => {
  insertDrop("shared", { owner_id: "mate", visibility: "public" })
  await setPinned("shared", who, true)
  sql.prepare("UPDATE drops SET share = 'private' WHERE id = 'shared'").run()
  assert.deepEqual(await titles(who), [])
  sql.prepare("UPDATE drops SET share = 'public' WHERE id = 'shared'").run()
  assert.deepEqual(await titles(who), ["shared"])
  sql.prepare("UPDATE drops SET trashed_at = ?, trash_reason = 'deleted' WHERE id = 'shared'").run(Date.now())
  assert.deepEqual(await titles(who), [])
})

test("a drop in a folder lists with the folders it sits in", async () => {
  insertDrop("folder", { kind: "folder", blob_key: null, title: "Plans" })
  insertDrop("inside", { parent_id: "folder" })
  await setPinned("inside", who, true)
  const [drop] = await listPinned(who)
  assert.deepEqual(
    drop.path.map((crumb) => crumb.title),
    ["Plans"],
  )
})

test("a drop's detail says whether you pinned it", async () => {
  state.who = who
  insertDrop("doc", { visibility: "public" })
  const before = await dropDetail(await findDrop("doc"), who, "https://drop.example")
  assert.equal(before.pinned, undefined)
  await setPinned("doc", who, true)
  const after = await dropDetail(await findDrop("doc"), who, "https://drop.example")
  assert.equal(after.pinned, true)
  assert.equal(after.owner.name, "Owner")
  const anonymous = await dropDetail(await findDrop("doc"), null, "https://drop.example")
  assert.equal(anonymous.pinned, undefined)
  assert.equal(anonymous.owner, undefined)
})

test("an adopted attachment no longer appears in Pinned or reports its former pin", async () => {
  insertDrop("doc")
  insertDrop("image", { kind: "image", filename: "image.png" })
  await setPinned("image", who, true)
  assert.deepEqual(await titles(who), ["image"])
  sql.prepare("UPDATE drops SET parent_id = 'doc' WHERE id = 'image'").run()
  assert.deepEqual(await titles(who), [])
  const detail = await dropDetail(await findDrop("image"), who, "https://drop.example")
  assert.equal(detail.pinned, undefined)
})

test("Pinned and detail both honor the current share approval policy", async () => {
  insertDrop("shared", { owner_id: "mate", visibility: "public", share_review: "pending" })
  await setPinned("shared", who, true)
  const request = event("/api/drops?pinned")
  state.shareApproval = true
  assert.deepEqual(await listPinned(who, request), [])
  state.shareApproval = false
  const detail = await dropDetail(await findDrop("shared", request), who, request.url.origin, request)
  assert.equal(detail.pinned, true)
  assert.deepEqual(
    (await listPinned(who, request)).map((drop) => drop.id),
    ["shared"],
  )
})

test("200 newer pins do not crowd out an older pin, whether hidden or openable", async () => {
  insertDrop("old", { owner_id: "mate", visibility: "public" })
  const pin = sql.prepare("INSERT INTO drop_pins (user_id, drop_id, at) VALUES (?, ?, ?)")
  pin.run(who.userId, "old", 1)
  for (let index = 0; index < 200; index++) {
    const id = `new-${index}`
    insertDrop(id, { owner_id: "mate", visibility: "private" })
    pin.run(who.userId, id, index + 2)
  }
  assert.deepEqual(await titles(who), ["old"])
  sql.exec("UPDATE drops SET share = 'public'")
  const openable = await titles(who)
  assert.equal(openable.length, 201)
  assert.equal(openable.at(-1), "old")
})
