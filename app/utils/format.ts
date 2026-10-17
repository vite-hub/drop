import prettyBytes from "pretty-bytes"

export const formatBytes = (bytes: number) => prettyBytes(bytes)

export const KIND_ICONS: Record<string, string> = {
  markdown: "i-ph-file-text",
  html: "i-ph-code",
  image: "i-ph-image",
  file: "i-ph-file",
  app: "i-ph-folder",
}

export const KIND_LABELS: Record<string, string> = { markdown: "Markdown", html: "HTML", image: "Image", file: "File", app: "App" }

export const VIA_LABELS: Record<string, string> = { agent: "MCP", browser: "the browser" }
