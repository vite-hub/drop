import type { EditorHandler, EditorSuggestionMenuProps, EditorToolbarProps } from "@nuxt/ui"

function itemGroups<Item>(items: Item[] | Item[][] = []): Item[][] {
  const groups: Item[][] = []
  for (const item of items) groups.push(Array.isArray(item) ? item : [item])
  return groups
}

export default defineNuxtPlugin(({ vueApp }) => {
  vueApp.component(
    "UEditorToolbar",
    defineAsyncComponent(async () => {
      const { default: Toolbar } = await import("@nuxt/ui/components/EditorToolbar.vue")
      return defineComponent(
        (props: Pick<EditorToolbarProps, "items" | "editor">) => {
          const controls = inject(viewerEditorControls, undefined)
          return () => {
            const { editor, items } = props
            if (!editor || !controls) return h(Toolbar, props)
            return h(Toolbar, {
              editor,
              items: [
                ...itemGroups(items),
                [
                  {
                    icon: "i-mingcute-link-line",
                    "aria-label": "Link",
                    active: editor.isActive("link"),
                    onClick: () => void controls.editLink(editor),
                  },
                ],
              ],
            })
          }
        },
        { props: ["editor", "items"] },
      )
    }),
  )
  vueApp.component(
    "UEditorSuggestionMenu",
    defineAsyncComponent(async () => {
      const { default: Menu } = await import("@nuxt/ui/components/EditorSuggestionMenu.vue")
      return defineComponent(
        (props: Pick<EditorSuggestionMenuProps, "items" | "editor">) => {
          const controls = inject(viewerEditorControls, undefined)
          const handlers = inject<ComputedRef<Record<string, EditorHandler>>>("editorHandlers")
          if (controls) {
            provide(
              "editorHandlers",
              computed(() => ({
                ...handlers?.value,
                image: {
                  canExecute: controls.canUpload,
                  execute: (editor: Parameters<typeof controls.chooseImage>[0]) => ({
                    run: () => controls.chooseImage(editor),
                  }),
                  isActive: () => false,
                },
              })),
            )
          }
          return () => {
            const { editor, items } = props
            if (!editor || !controls) return h(Menu, props)
            return h(Menu, {
              editor,
              items: [
                ...itemGroups(items),
                [{ kind: "image", label: "Image", icon: "i-lucide-image", disabled: !controls.canUpload(editor) }],
              ],
            })
          }
        },
        { props: ["editor", "items"] },
      )
    }),
  )
})
