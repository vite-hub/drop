// shadcn/typeset and the page around it, one copy shared by the /f/ document pages and the viewer's sandboxed documents.
// The app imports only typeset.css (for the live editor); document-shell.css would restyle every app page.
import shell from "./document-shell.css?raw"
import css from "./typeset.css?raw"

export const TYPESET_CSS = css + shell

/** Comark's alerts (`> [!NOTE]`) render as `<blockquote as="note">`, footnotes as a `.footnotes` section, and code blocks carry Shiki's `--shiki-dark` colors for dark mode; both the /f/ pages and the viewer style them. */
export const CALLOUT_CSS = `
blockquote[as], .callout { border: 1px solid var(--border, #e5e5e5); border-left-width: 3px; border-radius: 8px; padding: 0.5rem 1rem; margin: 1.25rem 0; font-style: normal; }
blockquote[as]::before { display: block; content: attr(as); font: 600 11px/1.6 ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.7; }
blockquote[as="tip"] { border-left-color: #16a34a; } blockquote[as="warning"], blockquote[as="caution"] { border-left-color: #d97706; } blockquote[as="important"] { border-left-color: #7c3aed; }
.dark .shiki span { color: var(--shiki-dark) !important; font-style: var(--shiki-dark-font-style) !important; font-weight: var(--shiki-dark-font-weight) !important; }
.footnotes { margin-top: 2.5rem; font-size: 0.875em; } .footnote-ref a, .footnote-backref { text-decoration: none; }
.shiki .line.highlight { display: inline-block; width: 100%; margin-inline: -1em; padding-inline: 1em; background: color-mix(in oklab, currentColor 8%, transparent); }
`
