import assert from "node:assert/strict"
import { test, vi } from "vite-plus/test"
import * as v from "valibot"
import { createFetch } from "ofetch"
import { sendFile } from "../../app/utils/send-file.ts"
import { answerCode, answerError, createClientErrorReporter, httpStatus } from "../../app/utils/client-errors.ts"

const page = { path: "/d/abc123", online: true, leaving: false }

function reporter() {
  const sent = []
  const events = []
  const report = createClientErrorReporter(
    (body) => sent.push(body),
    (body) => events.push(body),
  )
  return { sent, events, report: (action, error, fields = {}, at = page) => report(action, error, fields, at) }
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

test("a sign-in or consent refusal is reported as its step's failure, with its code", () => {
  const { sent, events, report } = reporter()
  // Better Auth's client error, kept by answerError, and an h3 answer through ofetch.
  report("signin", answerError("Sign in again", 401, "GITHUB_REAUTH_REQUIRED"))
  report("oauth-signin", { status: 403, statusText: "Forbidden", message: "No", code: "GITHUB_ORG_ACCESS_REQUIRED" })
  report("signin-switch", fetchError({ status: 403, data: { status: 403, data: { code: "BANNED_USER" } } }))
  report("oauth-consent", answerError("This authorization link is invalid", 401, "invalid_request"))
  report("oauth-consent", new Error("The agent didn't get an answer."))
  report("oauth-consent", answerError("Not allowed", 403, "Free text, not a code"))
  assert.deepEqual(events, [
    { event: "signin.failed", code: "GITHUB_REAUTH_REQUIRED", status: 401 },
    { event: "signin.failed", code: "GITHUB_ORG_ACCESS_REQUIRED", status: 403 },
    { event: "signin.failed", code: "BANNED_USER", status: 403 },
    { event: "consent.failed", code: "invalid_request", status: 401 },
    { event: "consent.failed" },
    { event: "consent.failed", status: 403 },
  ])
  // The server logged the answers; only the exception without one is a client error.
  assert.deepEqual(
    sent.map((body) => body.action),
    ["oauth-consent"],
  )
  report("notify", fetchError({ status: 401, data: { status: 401, data: { code: "SIGN_IN_REQUIRED" } } }))
  assert.equal(events.length, 6, "Other actions send no step")
})

test("a code outside the funnel schema is preserved only in the generic error report", () => {
  const { sent, events, report } = reporter()
  report("signin-switch", answerError("Couldn't sign out", 500, "provider/sign-out"))
  report("signin-switch", answerError("Couldn't sign out", 500, "provider/other"))
  assert.deepEqual(
    sent.map(({ code }) => code),
    ["provider/sign-out", "provider/other"],
  )
  assert.deepEqual(events, [
    { event: "signin.failed", status: 500 },
    { event: "signin.failed", status: 500 },
  ])
})

test("an OAuth provider's refusal keeps its error identifier, without the description", () => {
  const { events, report } = reporter()
  const expired = {
    status: 400,
    statusText: "Bad Request",
    error: "invalid_signature",
    error_description: "The signature for client abc123 is invalid",
  }
  assert.equal(answerCode(expired), "invalid_signature")
  assert.equal(answerCode({ status: 401, code: "UNAUTHORIZED", error: "invalid_request" }), "UNAUTHORIZED")
  assert.equal(answerCode({ status: 400, error: "free text with spaces" }), undefined)
  assert.equal(answerCode({ status: 400, message: "No identifier" }), undefined)
  report("oauth-consent", answerError("This authorization link has expired.", expired.status, answerCode(expired)))
  report("oauth-signin", answerError("Couldn't start GitHub sign-in.", 400, answerCode({ error: "invalid_client" })))
  assert.deepEqual(events, [
    { event: "consent.failed", code: "invalid_signature", status: 400 },
    { event: "signin.failed", code: "invalid_client", status: 400 },
  ])
  assert.doesNotMatch(JSON.stringify(events), /client abc123/)
})

test("a gateway's 5xx (502, 503, 504, the edge's 52x) is reported with its status and request id, unless Drop wrote it", () => {
  const { sent, report } = reporter()
  report("notify", fetchError({ status: 500, data: { status: 500, message: "Server Error" } }))
  report("notify", fetchError({ status: 500, data: { statusCode: 500, statusMessage: "Server Error" } }))
  assert.deepEqual(sent, [])
  report(
    "notify",
    fetchError({ status: 502, data: "<html>Bad gateway</html>", headers: { "cf-ray": "8f1e2d3c4b5a6978-AMS" } }),
  )
  report("upload", Object.assign(new Error("503"), { status: 503, requestId: "abc-123" }))
  report("notify", fetchError({ status: 524, data: "<html>A timeout occurred</html>" }))
  assert.deepEqual(
    sent.map((body) => [body.status, body.requestId]),
    [
      [502, "8f1e2d3c4b5a6978-AMS"],
      [503, "abc-123"],
      [524, undefined],
    ],
  )
})

test("a 5xx without Drop's error body is reported", () => {
  const { sent, report } = reporter()
  // A file fetched as a blob, an HTML error page, Better Auth's answer.
  report("image-load", fetchError({ status: 500, data: new Blob(["Server Error"]) }))
  report("visit", fetchError({ status: 500, data: "<!doctype html><title>500</title>" }))
  report("signin", { status: 500, statusText: "Internal Server Error", message: "Failed" })
  report("notify", fetchError({ status: 501 }))
  assert.equal(sent.length, 4)
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

for (const status of [200, 500, 503])
  test(`an invalid upload answer (${status}) is reported with its fallback request id`, async () => {
    class Request {
      status = status
      statusText = ""
      responseText = status === 200 ? "{}" : "<html>cloudflare</html>"
      open() {}
      setRequestHeader() {}
      getResponseHeader(name) {
        return name === "x-request-id" ? "upload-123" : null
      }
      addEventListener(name, callback) {
        if (name === "load") this.load = callback
      }
      send() {
        this.load()
      }
    }
    vi.stubGlobal("XMLHttpRequest", Request)
    try {
      const error = await sendFile("/upload", new FormData(), v.object({ id: v.string() })).catch((error) => error)
      const { sent, report } = reporter()
      report("upload", error)
      assert.equal(sent.length, 1)
      assert.equal(sent[0].status, status)
      assert.equal(sent[0].requestId, "upload-123")
    } finally {
      vi.unstubAllGlobals()
    }
  })

test("an ofetch HTML 500 from the edge keeps its cf-ray", async () => {
  const fetch = createFetch({
    defaults: { retry: 0 },
    fetch: async () =>
      new Response("<html>cloudflare</html>", {
        status: 500,
        headers: { "content-type": "text/html", "cf-ray": "edge-500" },
      }),
  })
  const error = await fetch("https://drop.example/api/drops").catch((error) => error)
  const { sent, report } = reporter()
  report("notify", error)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].status, 500)
  assert.equal(sent[0].requestId, "edge-500")
})
