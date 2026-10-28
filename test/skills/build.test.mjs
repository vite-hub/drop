import assert from "node:assert/strict"
import { afterEach, test, vi } from "vite-plus/test"
import { loadComarkSkills } from "../../modules/comark-skills.ts"

const markdown = "---\nname: comark-ui\ndescription: Block syntax\n---\nRead [blocks](references/blocks.md).\n"
const entry = { name: "comark-ui", description: "Block syntax", files: ["SKILL.md", "references/blocks.md"] }
const base = "https://comark-ui.onmax.me/.well-known/skills/"

afterEach(() => vi.unstubAllGlobals())

function upstream(skills = [entry]) {
  const fetch = vi.fn(async (url) => {
    if (url.href === `${base}index.json`) return Response.json({ skills })
    if (url.href === `${base}comark-ui/SKILL.md`) return new Response(markdown)
    if (url.href === `${base}comark-ui/references/blocks.md`) return new Response("# Blocks\n")
    return new Response("Unavailable", { status: 503 })
  })
  vi.stubGlobal("fetch", fetch)
  return fetch
}

test("build snapshot preserves the upstream skill and every relative reference", async () => {
  const fetch = upstream()
  assert.deepEqual(await loadComarkSkills(), [
    {
      name: "comark-ui",
      description: "Block syntax",
      source: `${base}comark-ui/SKILL.md`,
      files: [
        { path: "SKILL.md", text: markdown },
        { path: "references/blocks.md", text: "# Blocks\n" },
      ],
    },
  ])
  assert.equal(fetch.mock.calls.length, 3)
})

test("an unavailable reference fails the build snapshot instead of publishing a partial skill", async () => {
  upstream([{ ...entry, files: [...entry.files, "references/missing.md"] }])
  await assert.rejects(loadComarkSkills(), /references\/missing.md: HTTP 503/)
})

test("an unavailable index fails the build snapshot", async () => {
  vi.stubGlobal("fetch", async () => new Response("Unavailable", { status: 503 }))
  await assert.rejects(loadComarkSkills(), /index.json: HTTP 503/)
})

test.each(["../secret.md", "references/../../secret.md", "https://elsewhere.test/file", "%2e%2e/secret.md"])(
  "build snapshot rejects a path outside the skill: %s",
  async (path) => {
    const fetch = upstream([{ ...entry, files: [...entry.files, path] }])
    await assert.rejects(loadComarkSkills())
    assert.equal(fetch.mock.calls.length, 1)
  },
)

test("build snapshot rejects duplicate skill names", async () => {
  const fetch = upstream([entry, entry])
  await assert.rejects(loadComarkSkills())
  assert.equal(fetch.mock.calls.length, 1)
})

test("build snapshot rejects frontmatter that names a different skill", async () => {
  vi.stubGlobal("fetch", async (url) =>
    url.href === `${base}index.json`
      ? Response.json({ skills: [entry] })
      : new Response("---\nname: different-skill\ndescription: Wrong skill\n---\n"),
  )
  await assert.rejects(loadComarkSkills())
})
