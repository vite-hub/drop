import prettyBytes from "pretty-bytes"

export const formatBytes = (bytes: number) => prettyBytes(bytes)

export const KIND_ICONS: Record<string, string> = {
  markdown: "i-lucide-file-text",
  html: "i-lucide-code",
  image: "i-lucide-image",
  file: "i-lucide-file",
  app: "i-lucide-folder",
}

export const KIND_LABELS: Record<string, string> = { markdown: "Markdown", html: "HTML", image: "Image", file: "File", app: "App" }

export const VIA_LABELS: Record<string, string> = { agent: "MCP", browser: "the browser" }

export const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
