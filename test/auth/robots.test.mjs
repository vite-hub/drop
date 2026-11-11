import assert from "node:assert/strict"
import { test, vi } from "vite-plus/test"

vi.mock("h3", () => ({ defineHandler: (handler) => handler }))
vi.mock("nitro", () => ({ definePlugin: (plugin) => plugin }))
vi.mock("nitro/runtime-config", () => ({ useRuntimeConfig: () => ({ seoIndex: true }) }))

const { default: robots } = await import("../../server/routes/robots.txt.get.ts")
const { default: contentHeaders } = await import("../../server/plugins/content-headers.ts")
let onResponse
await contentHeaders({ hooks: { hook: (_name, fn) => (onResponse = fn) } })

const disallowed = (text) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("Disallow:"))
    .map((line) => line.slice("Disallow:".length).trim())
const blocks = (rules, path) => rules.some((rule) => rule && path.startsWith(rule))

// Google reads noindex only from a page it may fetch. A Disallow rule hides the header and lets a linked share URL
// show up in results as a bare link (Search Console: "Blocked by robots.txt").
test("share links stay crawlable so crawlers see their noindex header", () => {
  const event = { url: new URL("https://drop.example/robots.txt"), res: { headers: new Headers() } }
  const rules = disallowed(robots(event))
  assert.ok(blocks(rules, "/api/drops"))
  for (const path of ["/d/abc/before-after", "/d/abc/before-after.md", "/f/00000000-0000-4000-8000-000000000001.png"]) {
    assert.ok(!blocks(rules, path), path)
    const response = new Response("bytes")
    onResponse(response, { req: new Request(`https://drop.example${path}`) })
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow", path)
  }
})
