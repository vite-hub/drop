import type { H3Event } from "h3"
import { formatValue, type Cell, type CellValue, type Sheet } from "hucre"
import { parseCsv } from "hucre/csv"
import { readOds } from "hucre/ods"
import { readXls, readXlsx } from "hucre/xlsx"
import { log } from "evlog"
import { escapeUTF8 as escapeHtml } from "entities"
import { defineCachedFunction } from "nitro/cache"
import { MARKDOWN_CACHE_TTL } from "./markdown-cache"

/** The spreadsheets Drop previews, read-only. Anything else stays a plain file with a download. */
export const SPREADSHEET_EXTENSIONS = new Set([".csv", ".tsv", ".xlsx", ".xlsm", ".xls", ".ods"])

// A preview, not the workbook: past these the table says what it left out, and Download has the rest.
const MAX_ROWS = 2000
const MAX_COLUMNS = 100

export const spreadsheetExtension = (filename: string) => filename.match(/\.[a-z0-9]{1,16}$/i)?.[0].toLowerCase() ?? ""

async function readSheets(bytes: Uint8Array, extension: string): Promise<Sheet[]> {
  if (extension === ".csv" || extension === ".tsv")
    return [
      {
        name: "",
        rows: parseCsv(bytes, {
          delimiter: extension === ".tsv" ? "\t" : undefined,
          maxRows: MAX_ROWS + 1,
          typeInference: true,
          preserveLeadingZeros: true,
        }),
      },
    ]
  const options = {
    readStyles: true,
    maxRows: MAX_ROWS + 1,
    sheets: (info: { hidden?: boolean; veryHidden?: boolean }) => !info.hidden && !info.veryHidden,
  }
  const workbook =
    extension === ".ods"
      ? await readOds(bytes, options)
      : extension === ".xls"
        ? await readXls(bytes, options)
        : await readXlsx(bytes, options)
  return workbook.sheets.filter((sheet) => !sheet.kind || sheet.kind === "worksheet")
}

/** What the cell shows in Excel: its number format applied, a formula's last saved result. */
function display(value: CellValue, cell: Cell | undefined): string {
  const shown = value ?? cell?.formulaResult ?? null
  if (shown === null) return ""
  if (cell?.richText) return cell.richText.map((run) => run.text).join("")
  const format = cell?.style?.numFmt
  if (format || shown instanceof Date) {
    try {
      return formatValue(shown, format ?? "yyyy-mm-dd")
    } catch {}
  }
  // doctor-disable-next-line typescript/strict/no-runtime-typeof -- a cell's value is the parsed domain: Excel stores it as a number, text, boolean, or date
  if (typeof shown === "boolean") return shown ? "TRUE" : "FALSE"
  return String(shown)
}

const columnLetter = (index: number) => {
  let letter = ""
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter
  return letter
}

function sheetTable(sheet: Sheet): string {
  const rows = sheet.rows.slice(0, MAX_ROWS)
  // Trailing empty columns and rows are formatting Excel kept, not data.
  let width = 0
  let height = 0
  rows.forEach((row, r) =>
    row.forEach((value, c) => {
      if (display(value, sheet.cells?.get(`${r},${c}`)) === "") return
      width = Math.max(width, c + 1)
      height = r + 1
    }),
  )
  const columns = Math.min(width, MAX_COLUMNS)
  if (!height) return `<p class="sheet-empty">This sheet is empty.</p>`

  // A merge draws in its top-left cell; the cells it covers draw nothing.
  const spans = new Map<string, string>()
  const covered = new Set<string>()
  for (const merge of sheet.merges ?? []) {
    const rowspan = Math.min(merge.endRow, height - 1) - merge.startRow + 1
    const colspan = Math.min(merge.endCol, columns - 1) - merge.startCol + 1
    if (rowspan < 1 || colspan < 1) continue
    spans.set(
      `${merge.startRow},${merge.startCol}`,
      `${rowspan > 1 ? ` rowspan="${rowspan}"` : ""}${colspan > 1 ? ` colspan="${colspan}"` : ""}`,
    )
    for (let r = merge.startRow; r < merge.startRow + rowspan; r++)
      for (let c = merge.startCol; c < merge.startCol + colspan; c++)
        if (r !== merge.startRow || c !== merge.startCol) covered.add(`${r},${c}`)
  }

  const head = `<thead><tr><th class="corner"></th>${Array.from({ length: columns }, (_, c) => `<th>${columnLetter(c)}</th>`).join("")}</tr></thead>`
  const body = rows
    .slice(0, height)
    .map((row, r) => {
      const cells = Array.from({ length: columns }, (_, c) => {
        const key = `${r},${c}`
        if (covered.has(key)) return ""
        const cell = sheet.cells?.get(key)
        const value = row[c] ?? null
        const shown = display(value, cell)
        // doctor-disable-next-line typescript/strict/no-runtime-typeof -- a cell's value is the parsed domain: Excel stores it as a number, text, boolean, or date
        const numeric = typeof (value ?? cell?.formulaResult) === "number" || value instanceof Date
        const classes = [numeric && "n", cell?.style?.font?.bold && "b"].filter(Boolean).join(" ")
        return `<td${classes ? ` class="${classes}"` : ""}${spans.get(key) ?? ""}>${escapeHtml(shown)}</td>`
      }).join("")
      return `<tr><th>${r + 1}</th>${cells}</tr>`
    })
    .join("")
  const cut = [
    sheet.rows.length > MAX_ROWS && `the first ${MAX_ROWS.toLocaleString("en")} rows`,
    width > MAX_COLUMNS && `the first ${MAX_COLUMNS} columns`,
  ].filter(Boolean)
  const note = cut.length
    ? `<p class="sheet-note">Showing ${cut.join(" and ")}. Download the file for the rest.</p>`
    : ""
  return `<div class="sheet-scroll"><table>${head}<tbody>${body}</tbody></table></div>${note}`
}

/** The spreadsheet as HTML for the viewer: a tab per visible sheet, each a read-only grid of what its cells show. */
export async function renderSpreadsheet(bytes: Uint8Array, extension: string): Promise<string> {
  try {
    const sheets = await readSheets(bytes, extension)
    if (!sheets.length) return `<p class="sheet-empty">This workbook has no sheets to show.</p>`
    const tabs =
      sheets.length > 1
        ? `<nav class="sheet-tabs" role="tablist">${sheets.map((sheet, i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-sheet="${i}">${escapeHtml(sheet.name || `Sheet ${i + 1}`)}</button>`).join("")}</nav>`
        : ""
    return (
      tabs +
      sheets
        .map(
          (sheet, i) => `<section class="sheet" data-sheet="${i}"${i ? " hidden" : ""}>${sheetTable(sheet)}</section>`,
        )
        .join("")
    )
  } catch (error) {
    log.error({ action: "spreadsheet_render", error: error instanceof Error ? error.message : "Unknown error" })
    return `<p class="sheet-empty">Drop could not read this spreadsheet. Download it to open it.</p>`
  }
}

/** Keyed by blob key like Markdown renders (blobs never change); deleteMarkdownCache clears both. */
const cached = defineCachedFunction(
  async (_event: H3Event | undefined, _key: string, extension: string, bytes: () => Promise<Uint8Array>) => ({
    html: await renderSpreadsheet(await bytes(), extension),
  }),
  {
    name: "spreadsheet",
    maxAge: MARKDOWN_CACHE_TTL,
    swr: false,
    getKey: (_event: H3Event | undefined, key: string) => key,
  },
)

export const renderSpreadsheetCached = async (
  key: string,
  extension: string,
  bytes: () => Promise<Uint8Array>,
  event?: H3Event,
) => (await cached(event, key, extension, bytes)).html
