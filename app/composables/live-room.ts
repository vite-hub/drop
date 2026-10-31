import { Placeholder } from "@tiptap/extension-placeholder"
import { Link } from "@tiptap/extension-link"
import { Editor } from "@tiptap/vue-3"
import { ySyncPluginKey } from "@tiptap/y-tiptap"
import { RealtimeCaret } from "vite-hub/realtime/vue"

/**
 * The live editor's room and its Tiptap editor: Yjs, ProseMirror, and the code highlighter. useLiveEditor imports this
 * only when someone opens the editor, so readers never download it. Run inside an effect scope: leaving the scope
 * leaves the room.
 */
export function useLiveRoom(documentId: Ref<string | undefined>) {
  // Carets come from RealtimeCaret below, with a lighter selection tint than its default.
  const realtime = useRealtimeTiptap("drops", documentId, { enabled: () => Boolean(documentId.value), carets: false })
  const editor = shallowRef<Editor>()
  // Whether this person typed since the editor opened. The room's own changes (loading the draft, others typing) come
  // in as y-sync transactions and don't count.
  const edited = ref(false)

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
        Link.configure({ openOnClick: false }),
        Placeholder.configure({ placeholder: "Write, or type / for blocks, : for emoji, @ for people" }),
        RealtimeCaret.configure({
          awareness: markRaw(realtime.provider.value.awareness),
          selectionRender: (user) => ({
            class: "ProseMirror-yjs-selection",
            style: `background-color: color-mix(in oklab, ${user.color} 18%, transparent)`,
          }),
        }),
      ],
      autofocus: "end",
    })
    editor.value.on("update", ({ transaction }) => {
      if (!transaction.getMeta(ySyncPluginKey)?.isChangeOrigin) edited.value = true
    })
  })

  return { realtime, editor, edited }
}

export type LiveRoom = ReturnType<typeof useLiveRoom>
