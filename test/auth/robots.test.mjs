import assert from "node:assert/strict"
import { H3Event } from "h3"
import { test, vi } from "vite-plus/test"

vi.mock("nitro", () => ({ definePlugin: (plugin) => plugin }))
vi.mock("nitro/runtime-config", () => ({ useRuntimeConfig: () => ({ seoIndex: true }) }))

const { ROBOTS_DISALLOW } = await import("../../shared/robots.ts")
const { default: contentHeaders } = await import("../../server/plugins/content-headers.ts")
let onResponse
await contentHeaders({ hooks: { hook: (_name, fn) => (onResponse = fn) } })

const blocks = (rules, path) => rules.some((rule) => rule && path.startsWith(rule))

// Google reads noindex only from a page it may fetch. A Disallow rule hides the header and lets a linked share URL
// show up in results as a bare link (Search Console: "Blocked by robots.txt").
test("share links stay crawlable so crawlers see their noindex header", () => {
  const rules = ROBOTS_DISALLOW
  assert.ok(blocks(rules, "/api/drops"))
  for (const path of ["/d/abc/before-after", "/d/abc/before-after.md", "/f/00000000-0000-4000-8000-000000000001.png"]) {
    assert.ok(!blocks(rules, path), path)
    const response = new Response("bytes")
    onResponse(response, new H3Event(new Request(`https://drop.example${path}`)))
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow", path)
  }
})
