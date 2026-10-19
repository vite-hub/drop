import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { writeXlsx } from "hucre/xlsx"
import { state, calls, migrate, reset, insertDrop } from "./harness.mjs"
const { dropDetail, findDrop } = await import("../../server/utils/drops.ts")
const { renderSpreadsheet } = await import("../../server/utils/spreadsheet.ts")
const { planDocument } = await import("../../shared/documents.ts")

migrate()
beforeEach(reset)

test("a workbook shows each visible sheet's formatted values, merges, and no trailing blanks", async () => {
  const bytes = await writeXlsx({ sheets: [
    { name: "Plan", rows: [["Piece", "Qty", "Price", null], ["Bolt", 120, { value: 0.35, style: { numFmt: "$#,##0.00" } }, null], [null, null, null, null]], merges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 1 }] },
    { name: "Notes <b>", rows: [["ok"]] },
    { name: "Secret", rows: [["hidden"]], hidden: true },
  ] })
  const html = await renderSpreadsheet(bytes, ".xlsx")
  assert.match(html, /role="tab"[^>]*>Plan</)
  assert.match(html, />Notes &lt;b&gt;</)
  assert.doesNotMatch(html, /Secret|hidden<\/td>/)
  assert.match(html, /<td class="n">\$0\.35<\/td>/)
  assert.match(html, /<td colspan="2">Piece<\/td><td>Price<\/td><\/tr>/)
  assert.doesNotMatch(html, /<th>D<\/th>|<th>3<\/th>/)
})

test("a CSV infers numbers and escapes its text", async () => {
  const html = await renderSpreadsheet(new TextEncoder().encode("name,qty\n<script>,007\nnut,12\n"), ".csv")
  assert.doesNotMatch(html, /sheet-tabs|<script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /<td class="n">12<\/td>/)
  assert.match(html, />007</)
})

test("a file Drop can't read says so instead of failing the page", async () => {
  assert.match(await renderSpreadsheet(new Uint8Array([1, 2, 3]), ".xlsx"), /could not read this spreadsheet/)
})

test("a spreadsheet drop's detail carries its preview, rendered once per blob", async () => {
  const key = "00000000-0000-4000-8000-000000000002.csv"
  insertDrop("sheet", { kind: "file", filename: "plan.csv", blob_key: key })
  state.objects.set(key, { body: new Blob(["a,b\n1,2\n"]), uploadedAt: new Date() })
  const row = await findDrop("sheet")
  const first = await dropDetail(row, null, "https://drop.example")
  assert.match(first.html, /<td class="n">2<\/td>/)
  state.objects.delete(key)
  const second = await dropDetail(row, null, "https://drop.example")
  assert.equal(calls.get, 1)
  assert.equal(second.html, first.html)
  assert.match(planDocument("file", "", false, first.html), /class="sheets"/)
})

test("other files keep the download-only view", async () => {
  insertDrop("zip", { kind: "file", filename: "build.zip", blob_key: "00000000-0000-4000-8000-000000000003.zip" })
  const detail = await dropDetail(await findDrop("zip"), null, "https://drop.example")
  assert.equal(detail.html, undefined)
  assert.match(planDocument("file", "", false, ""), /No preview for this file type/)
})
