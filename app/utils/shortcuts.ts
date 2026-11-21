interface Shortcut {
  keys: string[]
  label: string
  where?: string
}

export const SHORTCUT_GROUPS: { title: string; where: string; shortcuts: Shortcut[] }[] = [
  {
    title: "General",
    where: "Any page, signed in",
    shortcuts: [
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["meta", "k"], label: "Search, act on the drop open, or make a new one" },
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
      { keys: ["m"], label: "Copy as Markdown", where: "A Markdown doc" },
      { keys: ["w"], label: "Switch the text width: readable, wide, or widest", where: "A Markdown doc" },
      { keys: ["z"], label: "Zen mode: hide the outline and fold the review pill to a handle" },
      { keys: ["escape"], label: "Close a comment, leave area mode, go back from a version, or leave zen mode" },
    ],
  },
  {
    title: "In a folder",
    where: "A folder's page",
    shortcuts: [
      { keys: ["/"], label: "Search this folder" },
      { keys: ["arrowdown"], label: "Preview the next drop, or the previous one with ↑", where: "A wide window" },
      { keys: ["enter"], label: "Open the drop picked" },
      { keys: ["F2"], label: "Rename the drop picked", where: "A drop you manage" },
      { keys: ["escape"], label: "Close the preview" },
    ],
  },
  {
    title: "Editing",
    where: "The live editor",
    shortcuts: [{ keys: ["meta", "s"], label: "Publish the draft as the next version" }],
  },
]

export const KEY_LABELS = new Map([
  ["meta", "⌘"],
  ["escape", "Esc"],
  ["arrowdown", "↓"],
  ["enter", "Enter"],
])
