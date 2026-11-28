export type ExtensionBrowser = "chrome" | "firefox"

const EXTENSION_STORES: Record<ExtensionBrowser, string | null> = {
  chrome: null,
  firefox: null,
}

const EXTENSION_DOCS = "/docs/extension"

export const EXTENSION_MARKER = "data-drop-extension"

export function extensionBrowser(userAgent: string): ExtensionBrowser | null {
  if (/Firefox\//.test(userAgent)) return "firefox"
  if (/Chrome\/|Chromium\//.test(userAgent)) return "chrome"
  return null
}

export function extensionLink(kind: ExtensionBrowser | null) {
  return (kind && EXTENSION_STORES[kind]) ?? EXTENSION_DOCS
}
