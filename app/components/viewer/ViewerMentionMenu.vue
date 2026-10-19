<script setup lang="ts">
// "@" names people in the doc. Nuxt UI's UEditorMentionMenu inserts a mention node, which the Realtime schema lacks
// (it would vanish on the next checkpoint), so this is the same menu writing plain "@Name" text, which Markdown keeps.
import theme from "#build/ui/editor-mention-menu"
import { useEditorMenu } from "@nuxt/ui/runtime/composables/useEditorMenu.js"
import { tv } from "@nuxt/ui/runtime/utils/tv.js"
import type { Editor } from "@tiptap/vue-3"

type Person = { label: string; avatar: { src?: string; alt: string } }

const props = defineProps<{ editor: Editor; people: Person[] }>()
const appConfig = useAppConfig()
const ui = computed(() => tv({ extend: theme, ...appConfig.ui?.editorMentionMenu })())
const UAvatar = resolveComponent("UAvatar")
const PLUGIN = "peopleMenu"

let menu: ReturnType<typeof useEditorMenu<Person>> | undefined
onMounted(async () => {
  await nextTick()
  if (props.editor.isDestroyed) return
  menu = useEditorMenu<Person>({
    editor: props.editor,
    char: "@",
    pluginKey: PLUGIN,
    items: toRef(() => props.people),
    limit: 8,
    ui,
    onSelect: (editor, range, person) => void editor.chain().focus().deleteRange(range).insertContent(`@${person.label} `).run(),
    renderItem: (person, styles) => [
      h(UAvatar, { ...person.avatar, size: styles.value.itemLeadingAvatarSize(), class: styles.value.itemLeadingAvatar() }),
      h("span", { class: styles.value.itemWrapper() }, [h("span", { class: styles.value.itemLabel() }, person.label)]),
    ],
  })
  props.editor.registerPlugin(menu.plugin)
})
onBeforeUnmount(() => {
  menu?.destroy()
  if (!props.editor.isDestroyed) props.editor.unregisterPlugin(PLUGIN)
})
</script>

<template>
  <span hidden />
</template>
