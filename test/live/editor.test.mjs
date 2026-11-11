import assert from "node:assert/strict"
import { test } from "vite-plus/test"

const { liveEditor } = await import("../../server/utils/live-editor.ts")
const { parseMarkdown } = await import("../../server/utils/markdown-document.ts")

// What a reader sees: Drop's own parse, without source positions.
const page = async (markdown) =>
  JSON.stringify((await parseMarkdown(markdown)).nodes, (key, value) => (key === "position" ? undefined : value))
const save = async (body) => liveEditor.toMarkdown(await liveEditor.fromMarkdown(body))

const report = `A note on the harbour. :cite[Diary, 1665]{href="https://example.com/diary"} Prices ran [min–max] by week.

See https://example.com/ledger for the ledger.[^1]

::chart{type="stacked" title="Barrels by week"}
| week | ale | wine |
| --- | --: | --: |
| 1 | 4 | 2 |
| 2 | 6 | 1 |

:::annotation{at="2" mark="circle"}
The fleet came in.
:::
::

::steps
### Count
Count the barrels.

### Record
Write it {++down++} in the ledger.
::

::details{summary="Sources"}
- The diary
::

[^1]: Kept at the office.
`

test("the live editor opens a doc with components, footnotes and suggested edits, and a save keeps what readers see", async () => {
  assert.deepEqual(await liveEditor.verify(report), { writable: true, canonical: await save(report) })
  const saved = await save(report)
  assert.equal(await page(saved), await page(report))
  assert.equal(await save(saved), saved)
})

// The plain-Markdown editor before wrote a bare URL as `[url](url)`, a chip with the URL as its text, and escaped
// `[min–max]` to `\\[min–max\\]`, a display formula.
test("a bare URL stays the same link and a bracketed span stays a span", async () => {
  const body = "See https://example.com/ledger, and prices ran [min–max] by week.\n"
  assert.equal(await page(await save(body)), await page(body))
  assert.match(await save(body), /\[min–max\]/)
})

// The editor reads TeX as text, so `}{2}` reads as attributes and a save would drop it.
test("a doc a save would change opens read-only", async () => {
  const body = "Each pair shares one roll:\n\n$$\n\\frac{n(n-1)}{2}\n$$\n"
  assert.equal((await liveEditor.verify(body)).writable, false)
})
