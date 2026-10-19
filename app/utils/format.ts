import prettyBytes from "pretty-bytes"
import type { ActorKind, DropKind } from "#shared/types"

export const formatBytes = (bytes: number) => prettyBytes(bytes)

export const KIND_ICONS: Record<DropKind, string> = {
  markdown: "i-ph-file-text",
  html: "i-ph-code",
  image: "i-ph-image",
  file: "i-ph-file",
  app: "i-ph-app-window",
  folder: "i-ph-folder",
  site: "i-ph-globe",
}

export const KIND_LABELS: Record<DropKind, string> = {
  markdown: "Markdown",
  html: "HTML",
  image: "Image",
  file: "File",
  app: "App",
  folder: "Folder",
  site: "Site",
}

export const VIA_LABELS: Record<ActorKind, string> = { agent: "MCP", browser: "the browser" }

/** "3 items", "1 item". */
export const itemCount = (n: number) => `${n} ${n === 1 ? "item" : "items"}`
