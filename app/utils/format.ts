import prettyBytes from "pretty-bytes"
import type { ActorKind, DropKind } from "#shared/types"

export const formatBytes = (bytes: number) => prettyBytes(bytes)

export const KIND_ICONS: Record<DropKind, string> = {
  markdown: "i-mingcute-document-2-line",
  html: "i-mingcute-code-line",
  image: "i-mingcute-pic-2-line",
  file: "i-mingcute-file-line",
  app: "i-mingcute-layout-line",
  folder: "i-mingcute-folder-line",
  site: "i-mingcute-world-2-line",
  board: "i-mingcute-drawing-board-line",
  link: "i-mingcute-link-line",
}

export const KIND_LABELS: Record<DropKind, string> = {
  markdown: "Markdown",
  html: "HTML",
  image: "Image",
  file: "File",
  app: "App",
  folder: "Folder",
  site: "Site",
  board: "Board",
  link: "Link",
}

export const VIA_LABELS: Record<ActorKind, string> = { agent: "MCP", browser: "the browser" }

export const itemCount = (n: number) => `${n} ${n === 1 ? "item" : "items"}`

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" })
const UNITS = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 30],
  ["month", 12],
  ["year", Infinity],
] as const
const SECONDS = { second: 1, minute: 60, hour: 3600, day: 86400, month: 2592000, year: 31536000 }

export function timeAgo(at: number | string | Date, now: number) {
  const seconds = (new Date(at).getTime() - now) / 1000
  if (seconds > -45) return "just now"
  const [unit] = UNITS.find(([name, limit]) => Math.abs(seconds / SECONDS[name]) < limit)!
  return relative.format(Math.round(seconds / SECONDS[unit]), unit)
}
