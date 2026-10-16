import { Extension } from "@tiptap/core"
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition } from "@tiptap/y-tiptap"
import * as Y from "yjs"

/** The slice of a y-websocket provider's awareness this needs. */
export interface CaretProvider {
  awareness: {
    clientID: number
    getStates(): Map<number, Record<string, unknown>>
    getLocalState(): Record<string, unknown> | null
    setLocalStateField(field: string, value: unknown): void
    on(event: "change", listener: () => void): void
    off(event: "change", listener: () => void): void
  }
}

type Person = { name: string; color: string }
type Cursor = { anchor: unknown; head: unknown }
type SyncState = { doc: Y.Doc; type: Y.XmlFragment; binding: { mapping: Map<unknown, unknown> } }

const key = new PluginKey("drop-live-carets")

/**
 * Realtime bundles its own y-tiptap, so TipTap's CollaborationCaret can't find its sync plugin. This finds that plugin
 * by name, publishes the local selection on the room's awareness (`cursor`, as y-prosemirror does), and draws
 * everyone else's caret and selection in their presence color.
 */
function syncState(state: EditorState) {
  const plugin = state.plugins.find(item => (item.spec.key as { key?: string } | undefined)?.key?.startsWith("y-sync$"))
  const value = plugin?.getState(state) as SyncState | undefined
  return value?.binding ? value : undefined
}

function caret(person: Person) {
  const element = document.createElement("span")
  element.className = "live-caret"
  element.style.setProperty("--caret", person.color)
  const label = document.createElement("span")
  label.className = "live-caret-label"
  label.textContent = person.name
  element.append(label)
  return element
}

function decorations(state: EditorState, provider: CaretProvider) {
  const sync = syncState(state)
  if (!sync) return DecorationSet.empty
  const found: Decoration[] = []
  const size = state.doc.content.size
  provider.awareness.getStates().forEach((value, clientId) => {
    const { cursor, user } = value as { cursor?: Cursor | null; user?: Person }
    if (clientId === provider.awareness.clientID || !cursor || !user?.color) return
    const toAbsolute = (position: unknown) => relativePositionToAbsolutePosition(sync.doc, sync.type, Y.createRelativePositionFromJSON(position), sync.binding.mapping as never)
    const anchor = toAbsolute(cursor.anchor)
    const head = toAbsolute(cursor.head)
    if (anchor === null || head === null) return
    const at = Math.max(0, Math.min(head, size))
    found.push(Decoration.widget(at, () => caret(user), { key: `caret-${clientId}-${user.name}`, side: 10 }))
    const from = Math.max(0, Math.min(anchor, head, size))
    const to = Math.min(Math.max(anchor, head), size)
    if (from < to) found.push(Decoration.inline(from, to, { class: "live-selection", style: `--caret: ${user.color}` }))
  })
  return DecorationSet.create(state.doc, found)
}

export const LiveCarets = Extension.create<{ provider: CaretProvider | undefined }>({
  name: "liveCarets",
  addOptions: () => ({ provider: undefined }),
  addProseMirrorPlugins() {
    const provider = this.options.provider
    if (!provider) return []
    return [new Plugin({
      key,
      state: {
        init: (_, state) => decorations(state, provider),
        apply: (tr, previous, _, state) => (tr.docChanged || tr.getMeta(key) ? decorations(state, provider) : previous.map(tr.mapping, tr.doc)),
      },
      props: { decorations: state => key.getState(state) as DecorationSet },
      view(view) {
        // Awareness changes arrive mid-update too (our own cursor), so redraw on the next frame.
        let frame = 0
        const redraw = () => {
          cancelAnimationFrame(frame)
          frame = requestAnimationFrame(() => !view.isDestroyed && view.dispatch(view.state.tr.setMeta(key, true)))
        }
        let published = ""
        const publish = () => {
          const sync = syncState(view.state)
          if (!sync) return
          const { anchor, head } = view.state.selection
          const cursor = view.hasFocus()
            ? { anchor: Y.relativePositionToJSON(absolutePositionToRelativePosition(anchor, sync.type, sync.binding.mapping as never)), head: Y.relativePositionToJSON(absolutePositionToRelativePosition(head, sync.type, sync.binding.mapping as never)) }
            : null
          const serialized = JSON.stringify(cursor)
          if (serialized === published) return
          published = serialized
          provider.awareness.setLocalStateField("cursor", cursor)
        }
        const blur = () => {
          published = "null"
          provider.awareness.setLocalStateField("cursor", null)
        }
        provider.awareness.on("change", redraw)
        view.dom.addEventListener("blur", blur)
        return {
          update: publish,
          destroy() {
            cancelAnimationFrame(frame)
            provider.awareness.off("change", redraw)
            view.dom.removeEventListener("blur", blur)
            if (provider.awareness.getLocalState()) provider.awareness.setLocalStateField("cursor", null)
          },
        }
      },
    })]
  },
})
