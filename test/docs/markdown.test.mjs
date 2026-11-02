import assert from "node:assert/strict"
import { H3 } from "h3"
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
  const asked = await app.fetch(
    new Request("https://drop.example/docs/agents", { headers: { accept: "text/markdown" } }),
  )
  assert.match(await asked.text(), /^# Agents/)
  assert.equal((await app.fetch(new Request("https://drop.example/docs/nope.md"))).status, 404)
})
