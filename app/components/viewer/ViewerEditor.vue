<script setup lang="ts">
import type { EditorEmojiMenuItem } from "@nuxt/ui"
import type { Editor } from "@tiptap/vue-3"
import { MarkdownEditor } from "@vite-hub/ui/markdown-editor"
import { chooseFiles, uploadKey, uploadPlugin, type UploadOptions } from "comark-ui/editor"
import * as v from "valibot"
import { DOC_WIDTHS, type DocWidth } from "#shared/documents"
import { EDITOR_IMAGE_PICK, editorImageExtension } from "#shared/editor-images"

const props = defineProps<{ editor?: Editor; synced: boolean; publishing: boolean; dropId: string; width: DocWidth }>()
const notify = useNotify()
const prompt = usePrompt()

const { people: members } = usePeople()
const people = computed(() =>
  members.value.map((member) => {
    const name = member.name ?? member.id
    return { label: name, avatar: { src: member.image, alt: name } }
  }),
)

const emojis = shallowRef<EditorEmojiMenuItem[]>([])
onMounted(async () => {
  emojis.value = (await import("@tiptap/extension-emoji")).gitHubEmojis.filter((emoji) => emoji.emoji)
})

const editorIds = new WeakMap<Editor, number>()
let lastEditorId = 0
const editorKey = computed(() => {
  const editor = props.editor
  if (!editor) return 0
  let id = editorIds.get(editor)
  if (id === undefined) editorIds.set(editor, (id = ++lastEditorId))
  return id
})

const canUpload = (editor: Editor) =>
  props.editor === editor && !editor.isDestroyed && editor.isEditable && props.synced && !props.publishing

const imageUpload = (editor: Editor): UploadOptions => ({
  pick: EDITOR_IMAGE_PICK,
  accept: (file) => {
    if (!canUpload(editor)) return false
    if (editorImageExtension(file.type)) return true
    notify.alert(`Couldn't upload ${file.name}`, "Choose a PNG, JPEG, GIF, WebP, or BMP image.")
    return false
  },
  async upload(file, progress) {
    const form = new FormData()
    form.append("file", file)
    form.append("document", props.dropId)
    const { url } = await sendFile("/api/files", form, v.object({ url: v.string() }), { onProgress: progress })
    return url
  },
  onError: (error, file) => notify.fail(`Couldn't upload ${file.name}`, error),
})

watch(
  () => props.editor,
  (editor, _, onCleanup) => {
    if (!editor) return
    const plugin = uploadPlugin(imageUpload(editor))
    const { handlePaste, handleDrop } = plugin.props
    plugin.props.handlePaste = (view, event, slice) =>
      handlePaste?.call(plugin, view, event, slice) || Boolean(event.clipboardData?.files.length)
    plugin.props.handleDrop = (view, event, slice, moved) =>
      handleDrop?.call(plugin, view, event, slice, moved) || (!moved && Boolean(event.dataTransfer?.files.length))
    editor.registerPlugin(plugin)
    onCleanup(() => {
      if (!editor.isDestroyed) editor.unregisterPlugin(uploadKey)
    })
  },
  { immediate: true },
)

provide(viewerEditorControls, {
  canUpload,
  chooseImage: (editor) => canUpload(editor) && chooseFiles(editor.view, imageUpload(editor)),
  async editLink(editor) {
    const previous: string | undefined = editor.getAttributes("link").href
    const href = await prompt({
      title: previous ? "Edit link" : "Insert link",
      label: "URL",
      initial: previous ?? "",
      confirmLabel: previous ? "Save" : "Insert",
      schema: previous ? v.pipe(v.string(), v.trim()) : undefined,
    })
    if (href === null || editor.isDestroyed || !editor.isEditable) return
    const chain = editor.chain().focus().extendMarkRange("link")
    void (href.trim() ? chain.setLink({ href: href.trim() }) : chain.unsetLink()).run()
  },
})
</script>

<template>
  <div class="drop-doc min-h-0 flex-1 overflow-y-auto">
    <main class="relative mx-auto px-6 pt-14 pb-24" :style="{ maxWidth: DOC_WIDTHS[width] }">
      <div v-if="!editor || !synced" aria-live="polite" class="space-y-4">
        <p class="sr-only">Loading the doc</p>
        <USkeleton class="h-8 w-2/3" />
        <USkeleton class="h-4 w-full" />
        <USkeleton class="h-4 w-11/12" />
        <USkeleton class="h-4 w-4/5" />
      </div>
      <MarkdownEditor v-if="editor" v-show="synced" :key="editorKey" class="typeset comark-typeset" :editor="editor" />
      <ViewerCodeLanguages v-if="editor && synced" :editor="editor" />
    </main>
    <template v-if="editor">
      <UEditorEmojiMenu :editor="editor" :items="emojis" :limit="24" />
      <ViewerMentionMenu :editor="editor" :people="people" />
    </template>
  </div>
</template>
