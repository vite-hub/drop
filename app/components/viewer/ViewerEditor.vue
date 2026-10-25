<script setup lang="ts">
// The live editor's page: the same column and typeset as the reader (shared/documents.ts), so editing a doc looks
// like reading it. Nuxt UI's bubble toolbar, "/" block menu, ":" emoji menu, "@" people menu, and drag handle sit on top;
// app.config.ts restyles them. Emoji and names go in as plain text, so the Markdown stays plain.
import type { EditorEmojiMenuItem, EditorSuggestionMenuItem, EditorToolbarItem } from "@nuxt/ui"
import { type Editor, EditorContent } from "@tiptap/vue-3"
import { DOC_WIDTHS, type DocWidth } from "#shared/documents"
// AvatarStack, ConnectionStatus, and the carets. The viewer loads this component only while someone edits.
import "vite-hub/ui/styles.css"

const props = defineProps<{ editor?: Editor; synced: boolean; width: DocWidth }>()
const prompt = usePrompt()

// Everyone in this Drop, for "@". Editors are always signed in. The editor only mounts in the browser, and nothing
// waits on the list.
const { data: members } = useApi("/api/people", { key: keys.people, default: () => [] })
const people = computed(() =>
  members.value.map((member) => ({ label: member.name, avatar: { src: member.image ?? undefined, alt: member.name } })),
)

// GitHub's emoji set, loaded with the editor rather than with the page. Custom GitHub images have no character to insert.
const emojis = shallowRef<EditorEmojiMenuItem[]>([])
onMounted(async () => {
  emojis.value = (await import("@tiptap/extension-emoji")).gitHubEmojis.filter((emoji) => emoji.emoji)
})

async function editLink() {
  const editor = props.editor
  if (!editor) return
  const previous: string | undefined = editor.getAttributes("link").href
  const href = await prompt({
    title: previous ? "Edit link" : "Insert link",
    label: "URL",
    initial: previous ?? "",
    confirmLabel: previous ? "Save" : "Insert",
  })
  if (href === null) return
  const chain = editor.chain().focus().extendMarkRange("link")
  void (href.trim() ? chain.setMark("link", { href: href.trim() }) : chain.unsetMark("link")).run()
}

const toolbar = computed<EditorToolbarItem[][]>(() => [
  [
    { kind: "mark", mark: "bold", icon: "i-mingcute-bold-line", "aria-label": "Bold" },
    { kind: "mark", mark: "italic", icon: "i-mingcute-italic-line", "aria-label": "Italic" },
    { kind: "mark", mark: "strike", icon: "i-mingcute-strikethrough-line", "aria-label": "Strikethrough" },
    { kind: "mark", mark: "code", icon: "i-mingcute-code-line", "aria-label": "Code" },
    {
      icon: "i-mingcute-link-line",
      "aria-label": "Link",
      active: props.editor?.isActive("link"),
      onClick: () => void editLink(),
    },
  ],
  [
    { kind: "heading", level: 1, icon: "i-mingcute-heading-1-line", "aria-label": "Heading 1" },
    { kind: "heading", level: 2, icon: "i-mingcute-heading-2-line", "aria-label": "Heading 2" },
    { kind: "heading", level: 3, icon: "i-mingcute-heading-3-line", "aria-label": "Heading 3" },
  ],
  [
    { kind: "bulletList", icon: "i-mingcute-list-check-line", "aria-label": "Bulleted list" },
    { kind: "orderedList", icon: "i-mingcute-list-ordered-line", "aria-label": "Numbered list" },
    { kind: "blockquote", icon: "i-mingcute-blockquote-line", "aria-label": "Quote" },
  ],
])

// Only blocks the Realtime schema has (StarterKit, image, table): a block it lacks would vanish on the next checkpoint.
const blocks: EditorSuggestionMenuItem[][] = [
  [
    { type: "label", label: "Blocks" },
    { kind: "paragraph", label: "Text", icon: "i-mingcute-text-line" },
    { kind: "heading", level: 1, label: "Heading 1", icon: "i-mingcute-heading-1-line" },
    { kind: "heading", level: 2, label: "Heading 2", icon: "i-mingcute-heading-2-line" },
    { kind: "heading", level: 3, label: "Heading 3", icon: "i-mingcute-heading-3-line" },
    { kind: "bulletList", label: "Bulleted list", icon: "i-mingcute-list-check-line" },
    { kind: "orderedList", label: "Numbered list", icon: "i-mingcute-list-ordered-line" },
    { kind: "blockquote", label: "Quote", icon: "i-mingcute-blockquote-line" },
    { kind: "codeBlock", label: "Code block", icon: "i-mingcute-terminal-box-line" },
    { kind: "horizontalRule", label: "Divider", icon: "i-mingcute-minimize-line" },
  ],
]
</script>

<template>
  <div class="drop-doc min-h-0 flex-1 overflow-y-auto">
    <main class="relative mx-auto px-6 pt-14 pb-24" :style="{ maxWidth: DOC_WIDTHS[width] }">
      <!-- The header says how the connection is going; here the doc's shape stands in until its text arrives. -->
      <div v-if="!editor || !synced" aria-live="polite" class="space-y-4">
        <p class="sr-only">Loading the doc</p>
        <USkeleton class="h-8 w-2/3" />
        <USkeleton class="h-4 w-full" />
        <USkeleton class="h-4 w-11/12" />
        <USkeleton class="h-4 w-4/5" />
      </div>
      <EditorContent v-show="editor && synced" class="typeset" :editor="editor" />
      <ViewerCodeLanguages v-if="editor && synced" :editor="editor" />
    </main>
    <template v-if="editor">
      <UEditorToolbar :editor="editor" :items="toolbar" layout="bubble" />
      <UEditorSuggestionMenu :editor="editor" :items="blocks" />
      <UEditorEmojiMenu :editor="editor" :items="emojis" :limit="24" />
      <ViewerMentionMenu :editor="editor" :people="people" />
      <UEditorDragHandle :editor="editor" icon="i-mingcute-dots-line" />
    </template>
  </div>
</template>
