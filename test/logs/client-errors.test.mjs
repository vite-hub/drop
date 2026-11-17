import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { createClientErrorReporter, httpStatus } from "../../app/utils/client-errors.ts"

const page = { path: "/d/abc123", online: true, leaving: false }

function reporter() {
  const sent = []
  const report = createClientErrorReporter((body) => sent.push(body))
  return { sent, report: (action, error, fields = {}, at = page) => report(action, error, fields, at) }
}

// ofetch's FetchError: `status` and `data` from the answer, `response` with its headers, `cause` when there was none.
function fetchError({ status, data, headers = {}, cause } = {}) {
  return Object.assign(new Error(`[POST] "/api/drops": ${status ?? "<no response>"}`), {
    name: "FetchError",
    status,
    statusCode: status,
    data,
    cause,
    response: status ? new Response(null, { status, headers }) : undefined,
  })
}

test("a client exception and a network failure are reported", () => {
  const { sent, report } = reporter()
  report("board-load", new TypeError("Cannot read properties of undefined"))
  report("notify", fetchError({ cause: new TypeError("Failed to fetch") }), { title: "Couldn't publish" })
  assert.equal(sent.length, 2)
  assert.deepEqual(
    { action: sent[0].action, name: sent[0].name, path: sent[0].path },
    { action: "board-load", name: "TypeError", path: "/d/abc123" },
  )
  assert.equal(sent[1].title, "Couldn't publish")
  assert.equal(sent[1].status, undefined)
})

test("an answer the server gave as a 4xx isn't reported", () => {
  const { sent, report } = reporter()
  for (const status of [400, 403, 404, 409, 422, 429])
    report("notify", fetchError({ status, data: { status, message: "No" } }))
  // Better Auth's client error, and an upload's (SendFileError).
  report("notify", { status: 403, statusText: "Forbidden", message: "Not allowed" })
  report("upload", Object.assign(new Error("413"), { status: 413 }))
  assert.deepEqual(sent, [])
})

test("a 5xx from Drop's server isn't reported again; one from in front of it is, with its status and request id", () => {
  const { sent, report } = reporter()
  report("notify", fetchError({ status: 500, data: { status: 500, message: "Server Error" } }))
  report("notify", fetchError({ status: 500, data: { statusCode: 500, statusMessage: "Server Error" } }))
  assert.deepEqual(sent, [])
  report(
    "notify",
    fetchError({ status: 502, data: "<html>Bad gateway</html>", headers: { "cf-ray": "8f1e2d3c4b5a6978-AMS" } }),
  )
  report("upload", Object.assign(new Error("503"), { status: 503, requestId: "abc-123" }))
  assert.deepEqual(
    sent.map((body) => [body.status, body.requestId]),
    [
      [502, "8f1e2d3c4b5a6978-AMS"],
      [503, "abc-123"],
    ],
  )
})

test("aborted requests, offline browsers, and pages that are leaving aren't reported", () => {
  const { sent, report } = reporter()
  report("notify", new DOMException("The user aborted a request.", "AbortError"))
  report("notify", fetchError({ cause: new DOMException("signal is aborted without reason", "AbortError") }))
  report("notify", fetchError({ cause: new TypeError("Failed to fetch") }), {}, { ...page, online: false })
  report("notify", fetchError({ cause: new TypeError("NetworkError") }), {}, { ...page, leaving: true })
  assert.deepEqual(sent, [])
})

test("each message is reported once, and at most ten times a page", () => {
  const { sent, report } = reporter()
  report("copy", new Error("Denied"))
  report("copy", new Error("Denied"))
  report("pdf", new Error("Denied"))
  assert.equal(sent.length, 2)
  for (let n = 0; n < 20; n++) report("vue", new Error(`Broke ${n}`))
  assert.equal(sent.length, 10)
})

test("a thrown non-error is reported by its message or text, and the fields are cut to the schema's limits", () => {
  const { sent, report } = reporter()
  report("unhandled", "plain string")
  report("notify", { status: 503, message: "Service unavailable" })
  report("vue", new Error("x".repeat(2000)), { title: "t".repeat(400), source: "s".repeat(400) })
  assert.equal(sent[0].message, "plain string")
  assert.equal(sent[0].stack, undefined)
  assert.equal(sent[1].message, "Service unavailable")
  assert.equal(sent[1].status, 503)
  assert.equal(sent[2].message.length, 1000)
  assert.equal(sent[2].title.length, 200)
  assert.equal(sent[2].source.length, 300)
})

test("httpStatus reads ofetch's, Better Auth's, and an upload's status, and none from a network failure", () => {
  assert.equal(httpStatus(fetchError({ status: 404 })), 404)
  assert.equal(httpStatus({ status: 401, statusText: "Unauthorized" }), 401)
  assert.equal(httpStatus(Object.assign(new Error("0"), { status: 0 })), undefined)
  assert.equal(httpStatus(fetchError({ cause: new TypeError("Failed to fetch") })), undefined)
  assert.equal(httpStatus(new Error("x")), undefined)
})
