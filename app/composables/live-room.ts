import { Placeholder } from "@tiptap/extension-placeholder"
import { createEditorCodec, uploadKey } from "comark-ui/editor"
import { Editor } from "@tiptap/vue-3"
import { ySyncPluginKey } from "@tiptap/y-tiptap"
import { LIVE_EDITOR_KIT } from "#shared/live-editor"
import type { Viewer } from "#shared/types"

export function useLiveRoom(documentId: Ref<string | undefined>, me: () => Viewer | null | undefined) {
  const realtime = useRealtimeTiptap("drafts", documentId, {
    enabled: () => Boolean(documentId.value),
    identity: () => {
      const viewer = me()
      return viewer && { id: viewer.id, name: viewer.name, email: viewer.email, image: viewer.image ?? undefined }
    },
    editor: createEditorCodec({ kit: LIVE_EDITOR_KIT }),
    carets: {
      selectionRender: (user) => ({
        class: "ProseMirror-yjs-selection",
        style: `background-color: color-mix(in oklab, ${user.color} 18%, transparent)`,
      }),
    },
  })
  const editor = shallowRef<Editor>()
  const uploading = ref(false)
  const edited = ref(false)
  const unsaved = ref(false)
  watch(realtime.synced, (synced) => synced && (unsaved.value = false))

  watch([realtime.document, realtime.provider], () => {
    editor.value?.destroy()
    editor.value = undefined
    uploading.value = false
    const extensions = realtime.extensions.value
    if (!extensions.length || !realtime.provider.value) return
    editor.value = new Editor({
      extensions: [
        ...extensions,
        CodeHighlight,
        Placeholder.configure({ placeholder: "Write, or type / for blocks, : for emoji, @ for people" }),
      ],
      autofocus: "end",
      onTransaction({ editor: current }) {
        uploading.value = Boolean(uploadKey.getState(current.state)?.find().length)
      },
    })
    editor.value.on("update", ({ transaction }) => {
      if (transaction.getMeta(ySyncPluginKey)?.isChangeOrigin) return
      edited.value = true
      if (!realtime.synced.value) unsaved.value = true
    })
  })

  return { realtime, editor, edited, unsaved, uploading }
}

export type LiveRoom = ReturnType<typeof useLiveRoom>
