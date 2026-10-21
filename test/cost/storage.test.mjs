import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { H3Event } from "h3"
import { migrate, reset, state, insertDrop, event } from "./harness.mjs"

const { dropDetail, findDrop } = await import("../../server/utils/drops.ts")
const { default: document } = await import("../../server/middleware/1.markdown-documents.ts")
const { default: report } = await import("../../server/api/reports.post.ts")

migrate()
beforeEach(reset)

const key = "00000000-0000-4000-8000-000000000001.html"
const reads = {
  detail: async () => dropDetail(await findDrop("doc"), null, "https://drop.example"),
  document: () => document(event(`/f/${key}`)),
  report: () => {
    const request = new H3Event(
      new Request("https://drop.example/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: `/f/${key}`, reason: "spam", details: "Unwanted content" }),
      }),
    )
    request.context.log = { set() {}, error() {} }
    return report(request)
  },
}

for (const [name, read] of Object.entries(reads)) {
  for (const [label, result, status] of [
    ["a null object", [null, null], 404],
    ["BLOB_NOT_FOUND", [Object.assign(new Error("Blob not found."), { code: "BLOB_NOT_FOUND" }), undefined], 404],
    [
      "a provider failure",
      [Object.assign(new Error("provider unavailable"), { code: "BLOB_OPERATION_FAILED" }), undefined],
      503,
    ],
  ]) {
    test(`${name} returns ${status} for ${label}`, async () => {
      if (name === "detail" || name === "document") insertDrop("doc", { kind: "html", blob_key: key })
      // Reports check that a file exists from its metadata; the rest read it.
      const method = name === "report" ? "head" : "get"
      const original = state.blob[method]
      state.blob[method] = async () => result
      try {
        await assert.rejects(read, (error) => error.status === status)
      } finally {
        state.blob[method] = original
      }
    })
  }
}

test("a report of a share link with a malformed escape is a 404, not a crash", async () => {
  const request = new H3Event(
    new Request("https://drop.example/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "/d/%E0", reason: "spam", details: "Unwanted content" }),
    }),
  )
  request.context.log = { set() {}, error() {} }
  await assert.rejects(report(request), (error) => error.status === 404)
})

test("a board image reads a missing object as none yet and a storage failure as 503", async () => {
  const { boardImage } = await import("../../server/utils/boards.ts")
  const original = state.blob.get
  try {
    state.blob.get = async () => [null, null]
    assert.equal(await boardImage({ link: "board" }, "overview"), null)
    state.blob.get = async () => [Object.assign(new Error("provider unavailable"), { code: "BLOB_OPERATION_FAILED" })]
    await assert.rejects(boardImage({ link: "board" }, "overview"), (error) => error.status === 503)
    // A frame id that climbs out of the board's folder once decoded has no image, and nothing is read.
    state.blob.get = async () => assert.fail("read a key outside the board")
    assert.equal(await boardImage({ link: "board" }, "%2e%2e/%2e%2e/x"), null)
  } finally {
    state.blob.get = original
  }
})
