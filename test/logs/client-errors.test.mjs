import assert from "node:assert/strict"
import { afterEach, test, vi } from "vite-plus/test"
import * as v from "valibot"
import { createFetch } from "ofetch"
import { vitehub } from "vite-hub"
import { sendFile } from "../../app/utils/send-file.ts"
import { answerCode, answerError, createClientErrorReporter, httpStatus } from "../../app/utils/client-errors.ts"

const page = { online: true, leaving: false }

function reporter() {
  const sent = []
  const events = []
  const report = createClientErrorReporter(
    (error, options) => sent.push({ error, ...options }),
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

const REPORTER = Symbol.for("vite-hub.browserErrors")

// ViteHub's page script, as `observability.browserErrors` puts it in the page, run on a page at `/d/abc123` whose
// `fetch` records each request.
async function browserPage() {
  const plugins = [vitehub({ host: "node", observability: { browserErrors: true } })].flat(Infinity)
  const plugin = (await Promise.all(plugins)).flat(Infinity).find((entry) => entry?.name === "vite-hub/browser-errors")
  const [{ children: source }] = plugin.transformIndexHtml()
  const requests = []
  const fetch = async (url, init) => {
    requests.push({ url, ...init, body: JSON.parse(init.body) })
    return new Response(null, { status: 204 })
  }
  const storage = new Map()
  const sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }
  new Function("fetch", "location", "addEventListener", "sessionStorage", source)(
    fetch,
    { pathname: "/d/abc123" },
    () => {},
    sessionStorage,
  )
  return requests
}

afterEach(() => {
  delete globalThis[REPORTER]
})

test("a handled failure posts to ViteHub's browser-errors route with Drop's fields", async () => {
  const requests = await browserPage()
  const report = createClientErrorReporter()
  report(
    "notify",
    fetchError({ status: 502, data: "<html>Bad gateway</html>", headers: { "cf-ray": "8f1e2d3c4b5a6978-AMS" } }),
    { title: "Couldn't publish", drop: "abc123" },
    page,
  )
  report("signin-switch", answerError("Couldn't sign out", 500, "provider/sign-out"), {}, page)
  assert.equal(requests.length, 2)
  const [{ url, method, body }] = requests
  assert.match(url, /\/_vitehub\/browser-errors$/)
  assert.equal(method, "POST")
  assert.deepEqual(
    { kind: body.kind, path: body.path, action: body.action, name: body.name },
    { kind: "handled", path: "/d/abc123", action: "notify", name: "FetchError" },
  )
  assert.deepEqual(body.fields, {
    title: "Couldn't publish",
    drop: "abc123",
    status: 502,
    requestId: "8f1e2d3c4b5a6978-AMS",
  })
  assert.equal(body.droppedFields, undefined)
  assert.deepEqual(requests[1].body.fields, { status: 500, code: "provider/sign-out" })
})

test("a refusal posts nothing", async () => {
  const requests = await browserPage()
  const report = createClientErrorReporter()
  report("notify", fetchError({ status: 403, data: { status: 403, message: "No" } }), {}, page)
  report("signin", { status: 401, statusText: "Unauthorized", message: "Invalid password" }, {}, page)
  report("notify", fetchError({ status: 500, data: { status: 500, message: "Server Error" } }), {}, page)
  assert.deepEqual(requests, [])
})

test("gateway retries with a different status are reported, but identical failures are not", async () => {
  const requests = await browserPage()
  const report = createClientErrorReporter()
  const message = "Couldn't start GitHub sign-in."
  for (const status of [502, 503, 502]) {
    const error = answerError(message, status)
    const stack = error.stack
    report("signin", error, {}, page)
    assert.equal(error.message, message)
    assert.equal(requests.find(({ body }) => body.fields.status === status).body.stack.includes(message), true)
    assert.equal(error.stack, stack)
  }
  assert.deepEqual(
    requests.map(({ body }) => [body.action, body.fields.status]),
    [
      ["signin", 502],
      ["signin", 503],
    ],
  )
})

test("a client exception and a network failure are reported", () => {
  const { sent, report } = reporter()
  report("board-load", new TypeError("Cannot read properties of undefined"))
  report("notify", fetchError({ cause: new TypeError("Failed to fetch") }), { title: "Couldn't publish" })
  assert.equal(sent.length, 2)
  assert.deepEqual(
    { action: sent[0].action, name: sent[0].error.name, fields: sent[0].fields },
    { action: "board-load", name: "TypeError", fields: {} },
  )
  assert.deepEqual(sent[1].fields, { title: "Couldn't publish" })
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
    sent.map(({ action }) => action),
    ["oauth-consent"],
  )
  report("notify", fetchError({ status: 401, data: { status: 401, data: { code: "SIGN_IN_REQUIRED" } } }))
  assert.equal(events.length, 6, "Other actions send no step")
})

test("distinct codes outside the funnel schema are preserved only in the generic error reports", async () => {
  const requests = await browserPage()
  const events = []
  const report = createClientErrorReporter(undefined, (body) => events.push(body))
  for (const code of ["provider/sign-out", "provider/other", "provider/sign-out"]) {
    report("signin-switch", answerError("Couldn't sign out", 500, code), {}, page)
  }
  assert.deepEqual(
    requests.map(({ body }) => body.fields.code),
    ["provider/sign-out", "provider/other"],
  )
  assert.deepEqual(events, [
    { event: "signin.failed", status: 500 },
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
    sent.map(({ fields }) => [fields.status, fields.requestId]),
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

test("a thrown non-error is reported by its message or text, and string fields keep 300 characters", () => {
  const { sent, report } = reporter()
  report("unhandled", "plain string")
  report("notify", { status: 503, message: "Service unavailable" })
  report("vue", new Error("x"), { title: "t".repeat(400), source: "s".repeat(400) })
  assert.equal(sent[0].error, "plain string")
  assert.equal(sent[1].error, "[HTTP 503] Service unavailable")
  assert.equal(sent[1].fields.status, 503)
  assert.equal(sent[2].fields.title.length, 300)
  assert.equal(sent[2].fields.source.length, 300)
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
      assert.equal(sent[0].fields.status, status)
      assert.equal(sent[0].fields.requestId, "upload-123")
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
  assert.equal(sent[0].fields.status, 500)
  assert.equal(sent[0].fields.requestId, "edge-500")
})
