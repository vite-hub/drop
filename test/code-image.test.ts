import assert from "node:assert/strict"
import { mock, test } from "node:test"
import type { CodeImageInput } from "../server/browsers/code-image.ts"

function browserFixture(options: {
  format?: "png" | "svg"
  fail?: "connect" | "target" | "navigate" | "release"
  invalidImage?: boolean
} = {}) {
  const format = options.format ?? "png"
  const calls: string[] = []
  const image = options.invalidImage
    ? Buffer.from("invalid")
    : format === "png"
      ? Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])
      : Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  const page = {
    async addInitScript(_script: unknown, scale: number) {
      calls.push(`scale:${scale}`)
    },
    async goto(url: string) {
      calls.push(`goto:${url}`)
      if (options.fail === "navigate") throw new Error("navigation failed")
    },
    locator(selector: string) {
      return {
        async count() { return 1 },
        async inputValue() {
          return JSON.stringify({ id: selector.includes("background") ? "candy" : "typescript" })
        },
        async waitFor() { calls.push("editor-ready") },
        async fill(code: string) { calls.push(`code:${code}`) },
        async click() { calls.push(`click:${selector}`) },
      }
    },
    async waitForEvent(event: string) {
      calls.push(`wait:${event}`)
      return {
        suggestedFilename: () => `code.${format}`,
        url: () => `data:image/${format};base64,${image.toString("base64")}`,
      }
    },
  }
  const context = {
    pages: () => [page],
    async newCDPSession() {
      if (options.fail === "target") throw new Error("target lookup failed")
      return {
        async send(method: string) {
          assert.equal(method, "Target.getTargetInfo")
          return { targetInfo: { targetId: "ray-tab" } }
        },
        async detach() { calls.push("target-detach") },
      }
    },
  }
  const browser = {
    contexts: () => [context],
    async close() {
      calls.push("browser-close")
      if (options.fail === "release") throw new Error("release failed")
    },
  }
  const binding = { fetch() { throw new Error("Tests must not call Cloudflare") } }
  return {
    calls,
    image,
    async connect(actualBinding: unknown, sessionId: string) {
      assert.equal(actualBinding, binding)
      assert.equal(sessionId, "cloudflare-session")
      calls.push("connect")
      if (options.fail === "connect") throw new Error("connect failed")
      return browser
    },
    provider: {
      features: { liveHandoff: false },
      isolation: "provider",
      name: "cloudflare",
      async open() {
        calls.push("provider-open")
        return {
          id: "cloudflare-session",
          connection: { binding, engine: "chromium", kind: "cloudflare-binding", sessionId: "cloudflare-session" },
          async close() { calls.push("provider-close") },
        }
      },
    },
  }
}

let fixture = browserFixture()
mock.module("vite-hub/browser/providers/cloudflare", {
  namedExports: {
    cloudflareBrowser(options: unknown) {
      assert.deepEqual(options, { binding: "BROWSER", engine: "chromium" })
      return fixture.provider
    },
  },
})
mock.module("@cloudflare/playwright", {
  namedExports: {
    connect: (binding: unknown, sessionId: string) => fixture.connect(binding, sessionId),
    launch() { throw new Error("Chromium must attach the provider session") },
  },
})
const { default: codeImage } = await import("../server/browsers/code-image.ts")

async function run(input: CodeImageInput) {
  return await codeImage.run(input, {
    get browser() { throw new Error("Ray exports require the native Playwright controller") },
  })
}

for (const format of ["png", "svg"] as const) {
  test(`exports Ray ${format} through the built-in Cloudflare Playwright controller`, async () => {
    fixture = browserFixture({ format })
    const image = await run({
      code: "const answer = 42",
      format,
      scale: 6,
      theme: "candy",
      language: "typescript",
    })

    assert.deepEqual(image, fixture.image)
    assert.deepEqual(fixture.calls.slice(0, 5), [
      "provider-open", "connect", "target-detach", "scale:6",
      "goto:https://ray.so/#theme=candy&language=typescript",
    ])
    assert.ok(fixture.calls.includes("code:const answer = 42"))
    assert.ok(fixture.calls.includes('click:button[aria-label="16"]'))
    const exportClick = format === "png"
      ? 'click:button[aria-label="Export as PNG"]'
      : 'click:[role="menuitem"]'
    assert.ok(fixture.calls.indexOf("wait:download") < fixture.calls.indexOf(exportClick))
    assert.deepEqual(fixture.calls.slice(-2), ["browser-close", "provider-close"])
  })
}

for (const fail of ["connect", "target", "navigate", "release"] as const) {
  test(`closes the provider session after ${fail} failure`, async () => {
    fixture = browserFixture({ fail })
    const message = {
      connect: "connect failed",
      target: "target lookup failed",
      navigate: "navigation failed",
      release: "release failed",
    }[fail]
    await assert.rejects(run({ code: "hello" }), { message })
    assert.equal(fixture.calls.at(-1), "provider-close")
    assert.equal(fixture.calls.filter(call => call === "provider-close").length, 1)
    assert.equal(fixture.calls.filter(call => call === "browser-close").length, fail === "connect" ? 0 : 1)
  })
}

for (const format of ["png", "svg"] as const) {
  test(`rejects invalid ${format} downloads and releases the session`, async () => {
    fixture = browserFixture({ format, invalidImage: true })
    await assert.rejects(run({ code: "hello", format }), /invalid (PNG|SVG) export/)
    assert.deepEqual(fixture.calls.slice(-2), ["browser-close", "provider-close"])
  })
}

test("rejects invalid input before opening a browser", async () => {
  fixture = browserFixture()
  await assert.rejects(run({ code: "" }), /Code must contain/)
  assert.deepEqual(fixture.calls, [])
})
