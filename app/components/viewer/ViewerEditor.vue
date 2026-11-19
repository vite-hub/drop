<script setup lang="ts">
// The live editor's page: the same column and typeset as the reader (shared/documents.ts), so editing a doc looks
// like reading it. ViteHub's MarkdownEditor brings the bubble toolbar, the "/" block menu, the drag handle, and image
// uploads on the Realtime room's editor; Drop adds the ":" emoji menu, the "@" people menu, and the code languages.
// Emoji and names go in as plain text, so the Markdown stays plain.
import type { EditorEmojiMenuItem } from "@nuxt/ui"
import type { Editor } from "@tiptap/vue-3"
import { MarkdownEditor, type MarkdownEditorUpload } from "@vite-hub/ui/markdown-editor"
import * as v from "valibot"
import { DOC_WIDTHS, type DocWidth } from "#shared/documents"

const props = defineProps<{ editor?: Editor; synced: boolean; width: DocWidth }>()
const notify = useNotify()

// The people who may read this drop, for "@", from the same list as the comment boxes.
const { people: members } = usePeople()
const people = computed(() =>
  members.value.map((member) => {
    const name = member.name ?? member.id
    return { label: name, avatar: { src: member.image, alt: name } }
  }),
)

// GitHub's emoji set, loaded with the editor rather than with the page. Custom GitHub images have no character to insert.
const emojis = shallowRef<EditorEmojiMenuItem[]>([])
onMounted(async () => {
  emojis.value = (await import("@tiptap/extension-emoji")).gitHubEmojis.filter((emoji) => emoji.emoji)
})

// MarkdownEditor keeps the editor it mounted with, and the room makes a new one for a new draft or connection.
const editorIds = new WeakMap<Editor, number>()
let lastEditorId = 0
const editorKey = computed(() => {
  const editor = props.editor
  if (!editor) return 0
  let id = editorIds.get(editor)
  if (id === undefined) editorIds.set(editor, (id = ++lastEditorId))
  return id
})

// A pasted, dropped, or picked image becomes the editor's own file drop, as an agent's upload does, and the doc links
// its /f/ URL. Publishing makes the files a doc embeds its attachments (server/utils/drops/write.ts).
const upload: MarkdownEditorUpload = async (file, progress) => {
  const form = new FormData()
  form.append("file", file)
  const { url } = await sendFile("/api/files", form, v.object({ url: v.string() }), { onProgress: progress })
  return url
}
// The Realtime schema has an image node but no video or audio one: those would vanish on the next checkpoint.
const isImage = (file: File) => file.type.startsWith("image/")
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
      <MarkdownEditor
        v-if="editor"
        v-show="synced"
        :key="editorKey"
        class="typeset comark-typeset"
        :editor="editor"
        :upload="upload"
        :accept="isImage"
        @upload-error="(error, file) => notify.fail(`Couldn't upload ${file.name}`, error)"
      />
      <ViewerCodeLanguages v-if="editor && synced" :editor="editor" />
    </main>
    <template v-if="editor">
      <UEditorEmojiMenu :editor="editor" :items="emojis" :limit="24" />
      <ViewerMentionMenu :editor="editor" :people="people" />
    </template>
  </div>
</template>
