// shadcn/typeset, one copy shared by the /f/ document pages and the viewer's sandboxed documents.
import css from "./typeset.css?raw"

export const TYPESET_CSS = css

/** Comark's alerts (`> [!NOTE]`) render as `<blockquote as="note">`; both the /f/ pages and the viewer style them. */
export const CALLOUT_CSS = `
blockquote[as], .callout { border: 1px solid var(--border, #e5e5e5); border-left-width: 3px; border-radius: 8px; padding: 0.5rem 1rem; margin: 1.25rem 0; font-style: normal; }
blockquote[as]::before { display: block; content: attr(as); font: 600 11px/1.6 ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.7; }
blockquote[as="tip"] { border-left-color: #16a34a; } blockquote[as="warning"], blockquote[as="caution"] { border-left-color: #d97706; } blockquote[as="important"] { border-left-color: #7c3aed; }
`;
