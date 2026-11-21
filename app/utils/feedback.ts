export const PREVIEW_SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"

export const CONTENT_SANDBOX = `${PREVIEW_SANDBOX} allow-same-origin`

export const previewSandbox = (kind: string) =>
  kind === "markdown" ? `${PREVIEW_SANDBOX} allow-modals` : PREVIEW_SANDBOX

export const frameAllow = (kind: string) =>
  kind === "markdown" ? "clipboard-write; fullscreen" : kind === "app" || kind === "html" ? PRESENT_ALLOW : undefined

const PRESENT_ALLOW = "fullscreen; display-capture; screen-wake-lock"
