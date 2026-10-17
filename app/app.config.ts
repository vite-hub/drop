// shadcn/ui's sizes and surfaces (new-york v4) on Nuxt UI's parts, so pages don't restyle them one by one:
// h-9 controls (h-8 small), 8px corners, hairline borders, one soft shadow only on floating layers, and a tooltip in
// the inverted color. The editor's menus share the floating surface. Tokens live in app/assets/css/main.css.
const floating = "bg-default ring ring-default rounded-lg shadow-md"
const surface = `${floating} [animation:pop-in_120ms_var(--ease-out)]`

export default defineAppConfig({
  ui: {
    colors: { primary: "neutral", neutral: "neutral" },
    button: {
      variants: {
        size: {
          xs: { base: "h-7 px-2 text-xs gap-1", leadingIcon: "size-3.5", trailingIcon: "size-3.5" },
          sm: { base: "h-8 px-3 text-sm gap-1.5", leadingIcon: "size-4", trailingIcon: "size-4" },
          md: { base: "h-9 px-4 text-sm gap-2", leadingIcon: "size-4", trailingIcon: "size-4" },
          lg: { base: "h-10 px-6 text-sm gap-2", leadingIcon: "size-4", trailingIcon: "size-4" },
        },
      },
      compoundVariants: [
        { square: true, size: "xs", class: "w-7 p-0 justify-center" },
        { square: true, size: "sm", class: "w-8 p-0 justify-center" },
        { square: true, size: "md", class: "w-9 p-0 justify-center" },
        { square: true, size: "lg", class: "w-10 p-0 justify-center" },
        { color: "neutral", variant: "outline", class: "ring-default shadow-xs dark:bg-elevated/40" },
      ],
    },
    input: {
      variants: {
        size: {
          sm: { base: "h-8 px-3 text-sm" },
          md: { base: "h-9 px-3 text-sm" },
          lg: { base: "h-10 px-3 text-sm" },
        },
      },
      compoundVariants: [{ color: "neutral", variant: "outline", class: "shadow-xs" }],
    },
    textarea: {
      compoundVariants: [{ color: "neutral", variant: "outline", class: "shadow-xs text-sm" }],
    },
    select: {
      variants: { size: { sm: { base: "h-8 px-3 text-sm" }, md: { base: "h-9 px-3 text-sm" } } },
      compoundVariants: [{ color: "neutral", variant: "outline", class: "shadow-xs" }],
    },
    card: {
      slots: { root: "rounded-xl", header: "p-6 pb-0", body: "p-6", footer: "p-6 pt-0" },
    },
    tabs: {
      compoundVariants: [{
        color: "neutral",
        variant: "pill",
        class: {
          indicator: "bg-default dark:bg-accented shadow-xs",
          trigger: "data-[state=active]:text-highlighted",
        },
      }],
    },
    dropdownMenu: {
      slots: { content: `${floating} p-1`, item: "rounded-md before:rounded-md" },
    },
    popover: { slots: { content: floating } },
    tooltip: {
      slots: { content: "bg-inverted text-inverted ring-0 shadow-none rounded-md h-auto px-3 py-1.5 text-xs" },
    },
    modal: { slots: { content: "ring-default" } },
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
    editorEmojiMenu: {
      slots: { content: `min-w-56 max-w-64 max-h-80 ${surface} ring-0 flex flex-col overflow-hidden` },
    },
    editorMentionMenu: {
      slots: { content: `min-w-56 max-w-64 max-h-80 ${surface} ring-0 flex flex-col overflow-hidden` },
    },
    editorDragHandle: {
      slots: { handle: "cursor-grab px-0.5 text-dimmed hover:text-muted" },
    },
  },
})
