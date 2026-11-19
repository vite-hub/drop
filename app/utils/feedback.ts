/** The sandbox drops render in by default: scripts run, but with an opaque origin, so they can't reach Drop's session. */
export const PREVIEW_SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"

/**
 * Apps and HTML docs on the content origin keep that origin, so storage and history work. It's another host than
 * Drop's, so they still can't reach Drop's session, and the sandbox still keeps them from navigating Drop's tab.
 */
export const CONTENT_SANDBOX = `${PREVIEW_SANDBOX} allow-same-origin`

/**
 * The sandbox for a srcdoc frame. A Markdown doc may also open the print dialog, for Export as PDF: Drop renders it
 * and escapes its raw HTML, so only Drop's and Comark's scripts could call print() or alert(). HTML docs and apps run
 * their author's scripts, and allow-modals would let those put alert() and prompt() over Drop's own page.
 */
export const previewSandbox = (kind: string) =>
  kind === "markdown" ? `${PREVIEW_SANDBOX} allow-modals` : PREVIEW_SANDBOX

/**
 * What a frame may do beyond its sandbox. Only Markdown docs may write to the clipboard, so comark-annotate's Copy
 * button works: Drop renders them itself, escaping raw HTML, so their only scripts are Drop's and Comark's. HTML docs
 * and apps run whatever their author wrote, and writing to a reader's clipboard is how paste-jacking works. Markdown
 * docs also go full screen, for comark-media's video button.
 */
export const frameAllow = (kind: string) =>
  kind === "markdown" ? "clipboard-write; fullscreen" : kind === "app" || kind === "html" ? PRESENT_ALLOW : undefined

/**
 * What apps and HTML docs get instead, so a deck presents as on its own host (Slidev's fullscreen button, its Screen
 * Mirror, a screen that stays on). The browser announces fullscreen and asks before anyone's screen is captured.
 */
const PRESENT_ALLOW = "fullscreen; display-capture; screen-wake-lock"
