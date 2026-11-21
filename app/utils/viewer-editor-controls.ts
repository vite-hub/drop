import type { Editor } from "@tiptap/vue-3"
import type { InjectionKey } from "vue"

export const viewerEditorControls: InjectionKey<{
  editLink: (editor: Editor) => Promise<void>
  chooseImage: (editor: Editor) => boolean
  canUpload: (editor: Editor) => boolean
}> = Symbol("viewerEditorControls")
