import { Placeholder } from "@tiptap/extension-placeholder"
import { createEditorCodec } from "comark-ui/editor"
import { Editor } from "@tiptap/vue-3"
import { ySyncPluginKey } from "@tiptap/y-tiptap"
import { LIVE_EDITOR_KIT } from "#shared/live-editor"

/**
 * The live editor's room and its Tiptap editor: Yjs, ProseMirror, and the code highlighter. useLiveEditor imports this
 * only when someone opens the editor, so readers never download it. Run inside an effect scope: leaving the scope
 * leaves the room.
 */
export function useLiveRoom(documentId: Ref<string | undefined>) {
  const realtime = useRealtimeTiptap("drafts", documentId, {
    enabled: () => Boolean(documentId.value),
    // The room's schema (server/utils/live-editor.ts).
    editor: createEditorCodec({ kit: LIVE_EDITOR_KIT }),
    // A lighter selection tint than the default.
    carets: {
      selectionRender: (user) => ({
        class: "ProseMirror-yjs-selection",
        style: `background-color: color-mix(in oklab, ${user.color} 18%, transparent)`,
      }),
    },
  })
  const editor = shallowRef<Editor>()
  // Whether this person typed since the editor opened. The room's own changes (loading the draft, others typing) come
  // in as y-sync transactions and don't count.
  const edited = ref(false)
  // Whether they typed something the room hasn't had yet: set by their edits while out of sync, cleared each time the
  // room catches up.
  const unsaved = ref(false)
  watch(realtime.synced, (synced) => synced && (unsaved.value = false))

  // The room's extensions exist once its Y.Doc and provider do. Rebuild the editor only for a new room: the extensions
  // list is recomputed on reconnects too, and a rebuild would drop focus mid-sentence.
  watch([realtime.document, realtime.provider], () => {
    editor.value?.destroy()
    editor.value = undefined
    const extensions = realtime.extensions.value
    if (!extensions.length || !realtime.provider.value) return
    editor.value = new Editor({
      extensions: [
        ...extensions,
        CodeHighlight,
        Placeholder.configure({ placeholder: "Write, or type / for blocks, : for emoji, @ for people" }),
      ],
      autofocus: "end",
    })
    editor.value.on("update", ({ transaction }) => {
      if (transaction.getMeta(ySyncPluginKey)?.isChangeOrigin) return
      edited.value = true
      if (!realtime.synced.value) unsaved.value = true
    })
  })

  return { realtime, editor, edited, unsaved }
}

export type LiveRoom = ReturnType<typeof useLiveRoom>
