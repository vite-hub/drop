// Every keyboard shortcut, once: the ? dialog (ShortcutsModal) and the docs' table read this list. The bindings
// themselves live where they act (the dashboard layout, the Drops page, DropViewer); keep them in step with it.
// Keys are UKbd values, so `meta` shows as ⌘ on a Mac and Ctrl elsewhere.
export interface Shortcut {
  keys: string[]
  label: string
  /** Where it works, when that's narrower than its group's. */
  where?: string
}

export const SHORTCUT_GROUPS: { title: string; where: string; shortcuts: Shortcut[] }[] = [
  {
    title: "General",
    where: "Any page, signed in",
    shortcuts: [
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["meta", "k"], label: "Search drops, docs, and pages" },
      { keys: ["meta", "b"], label: "Hide or show the sidebar" },
      { keys: ["/"], label: "Search the Drops page", where: "The Drops page" },
    ],
  },
  {
    title: "In a drop",
    where: "A drop's page",
    shortcuts: [
      { keys: ["c"], label: "Open the comments" },
      { keys: ["h"], label: "Open the history", where: "A doc with more than one version" },
      { keys: ["i"], label: "Open the details", where: "A drop you manage" },
      { keys: ["r"], label: "Comment on an area" },
      { keys: ["e"], label: "Edit together" },
      { keys: ["l"], label: "Copy the link" },
      { keys: ["m"], label: "Copy as Markdown", where: "A doc or a single HTML page" },
      { keys: ["escape"], label: "Close a comment, leave area mode, or go back from a version" },
    ],
  },
  {
    title: "Editing",
    where: "The live editor",
    shortcuts: [{ keys: ["meta", "s"], label: "Publish the draft as the next version" }],
  },
]

/** How the docs print a key that isn't a single letter. The docs show a Mac's ⌘ and say Ctrl works elsewhere. */
export const KEY_LABELS = new Map([
  ["meta", "⌘"],
  ["escape", "Esc"],
])
