// The editor overrides follow Drop's first editor: a hairline card, 8px corners, one soft shadow, a 120ms entrance,
// and mono uppercase labels (see app/assets/css/main.css).
const surface = "bg-default border border-default rounded-lg shadow-[0_4px_16px_rgb(0_0_0/0.08)] [animation:pop-in_120ms_var(--ease-out)]"

export default defineAppConfig({
  ui: {
    colors: { primary: "neutral", neutral: "neutral" },
    editorToolbar: {
      slots: { base: "gap-1", separator: "my-1 bg-(--ui-border)" },
      variants: { layout: { bubble: { base: `${surface} p-0.5` } } },
    },
    editorSuggestionMenu: {
      slots: {
        content: `min-w-56 max-w-60 max-h-96 ${surface} ring-0 flex flex-col overflow-hidden`,
        label: "font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-muted",
      },
    },
    editorDragHandle: {
      slots: { handle: "cursor-grab px-0.5 text-dimmed hover:text-muted" },
    },
  },
})
