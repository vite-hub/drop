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
}

export const VIA_LABELS: Record<ActorKind, string> = { agent: "MCP", browser: "the browser" }

/** "3 items", "1 item". */
export const itemCount = (n: number) => `${n} ${n === 1 ? "item" : "items"}`
