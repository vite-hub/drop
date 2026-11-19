import assert from "node:assert/strict"
import { defineMiddleware, H3 } from "h3"
import { defineContentMarkdownHandler } from "vite-hub/content/markdown"
import { test } from "vite-plus/test"

const { default: docsMarkdown } = await import("../../server/middleware/0.08.docs-markdown.ts")

// The markup DocsPage renders: a heading's own anchor, links between pages, a screenshot, a table, a code block.
const PAGE = `<!doctype html><html><body><nav><a href="/docs">Docs</a></nav><main><article>
<h1>Agents</h1>
<p>Connect over <a href="/docs/agents#mcp">MCP</a>, then read <a href="/docs/self-host/">Host it yourself</a> or <a href="https://vitehub.dev">ViteHub</a>.</p>
<figure class="not-prose"><img src="/docs/agents.webp" alt="The MCP page"></figure>
<h2 id="tools"><a href="#tools">Tools</a></h2>
<table><thead><tr><th>Name</th><th>What it does</th></tr></thead><tbody><tr><td><code>read_drop</code></td><td>Reads a drop.</td></tr></tbody></table>
<pre><code><span class="line"><span>claude mcp add drop</span></span>
<span class="line"><span>codex mcp add drop</span></span></code></pre>
<button>Copy</button>
<ul><li>One <strong>doc</strong></li><li>An <em>app</em></li></ul>
</article></main></body></html>`

const app = new H3()
  .use(docsMarkdown)
  .use(
    defineMiddleware(
      defineContentMarkdownHandler(
        { seo: { markdown: true }, markdown: async () => null },
        { render: (request) => app.fetch(request) },
      ),
    ),
  )
  .get("/docs/agents", () => new Response(PAGE, { headers: { "content-type": "text/html" } }))

test("a docs page as Markdown keeps its text, links its pages' .md, and leaves figures and buttons out", async () => {
  const response = await app.fetch(new Request("https://drop.example/docs/agents.md"))
  assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8")
  assert.equal(
    await response.text(),
    `# Agents

Connect over [MCP](https://drop.example/docs/agents.md#mcp), then read [Host it yourself](https://drop.example/docs/self-host.md) or [ViteHub](https://vitehub.dev).

## Tools

| Name | What it does |
| --- | --- |
| \`read_drop\` | Reads a drop. |

\`\`\`
claude mcp add drop
codex mcp add drop
\`\`\`

- One **doc**
- An *app*
`,
  )
  assert.equal((await app.fetch(new Request("https://drop.example/docs/nope.md"))).status, 404)
})

test("Content negotiates the docs copy using client order at equal quality", async () => {
  const request = (accept, agent) =>
    app.fetch(new Request("https://drop.example/docs/agents", { headers: { accept, "user-agent": agent } }))
  const html = await request("text/html;q=0.8, text/markdown;q=0.8", "browser")
  assert.equal(html.headers.get("content-type"), "text/html")
  for (const response of [
    await request("text/markdown;q=0.8, text/html;q=0.8", "browser"),
    await request("text/html, text/markdown", "Claude-User/1.0"),
  ]) {
    assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8")
    assert.match(await response.text(), /^# Agents\n/)
  }
})

test("Content keeps docs in HTML when only a wildcard matches Markdown and HTML is acceptable", async () => {
  for (const [accept, contentType] of [
    ["text/html;q=0.8, */*;q=1", "text/html"],
    ["text/*, text/html", "text/html"],
    ["text/html;q=0, text/*", "text/markdown; charset=utf-8"],
    ["text/html;q=0, text/markdown;q=0, text/*", "text/html"],
  ]) {
    const response = await app.fetch(new Request("https://drop.example/docs/agents", { headers: { accept } }))
    assert.equal(response.headers.get("content-type"), contentType, accept)
  }
})
