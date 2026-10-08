import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { H3Event } from "h3"
import { migrate, reset, state, insertDrop, event } from "./harness.mjs"

const { requireBlobAccess } = await import("../../server/utils/content-access.ts")
const { dropDetail, findDrop } = await import("../../server/utils/drops.ts")
const { default: document } = await import("../../server/middleware/1.markdown-documents.ts")
const { default: report } = await import("../../server/api/reports.post.ts")

migrate()
beforeEach(reset)

const key = "00000000-0000-4000-8000-000000000001.html"
const reads = {
  head: () => requireBlobAccess(event(`/f/${key}`), key),
  detail: async () => dropDetail(await findDrop("doc"), null, "https://drop.example"),
  document: () => document(event(`/f/${key}`)),
  report: () => {
    const request = new H3Event(new Request("https://drop.example/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: `/f/${key}`, reason: "spam", details: "Unwanted content" }),
    }))
    request.context.log = { set() {}, error() {} }
    return report(request)
  },
}

for (const [name, read] of Object.entries(reads)) {
  for (const [label, result, status] of [
    ["a null object", [null, null], 404],
    ["BLOB_NOT_FOUND", [Object.assign(new Error("Blob not found."), { code: "BLOB_NOT_FOUND" }), undefined], 404],
    ["a provider failure", [Object.assign(new Error("provider unavailable"), { code: "BLOB_OPERATION_FAILED" }), undefined], 503],
  ]) {
    test(`${name} returns ${status} for ${label}`, async () => {
      if (name === "detail" || name === "document") insertDrop("doc", { kind: "html", blob_key: key })
      const method = name === "head" ? "head" : "get"
      const original = state.blob[method]
      state.blob[method] = async () => result
      try {
        await assert.rejects(read, error => error.status === status)
      }
      finally { state.blob[method] = original }
    })
  }
}
