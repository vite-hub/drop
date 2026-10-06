import type { DropDetail, DropSummary } from "#shared/types"

/**
 * Editing a drop: the Notion-like editor (Markdown) or the source (HTML) for docs, drafts of files for apps.
 * Nothing is saved until Publish, which creates the next version.
 */
export function useDropEditor(drop: Ref<DropDetail>, options: {
  publicView: boolean
  publish: (body: { content: string } | { files: Record<string, string> }) => Promise<DropSummary | undefined>
  onAppPublished?: () => void
}) {
  const confirm = useConfirm()
  const notify = useNotify()
  const docEdit = ref<{ text: string; mode: "rich" | "source"; saving: boolean } | null>(null)
  const editorSource = ref(drop.value.content ?? "")
  const drafts = ref<Record<string, string> | null>(null)
  const appSaving = ref(false)

  const docDirty = computed(() => (docEdit.value ? docEdit.value.text !== (drop.value.content ?? "") : false))
  const appDirty = computed(() => (drafts.value ? Object.keys({ ...drafts.value, ...drop.value.files }).some(path => drafts.value![path] !== drop.value.files?.[path]) : false))
  const editing = computed(() => Boolean(docEdit.value || drafts.value))
  const dirty = computed(() => docDirty.value || appDirty.value)
  const saving = computed(() => Boolean(docEdit.value?.saving || appSaving.value))

  function start() {
    if (drop.value.kind === "app") {
      drafts.value = { ...(drop.value.files ?? {}) }
      return
    }
    editorSource.value = drop.value.content ?? ""
    docEdit.value = { text: drop.value.content ?? "", mode: drop.value.kind === "markdown" ? "rich" : "source", saving: false }
  }

  async function cancel() {
    if (dirty.value && !await confirm({ title: "Discard your changes?", description: "Nothing was published.", confirmLabel: "Discard", destructive: true })) return
    docEdit.value = null
    drafts.value = null
  }

  async function save() {
    if (!editing.value || saving.value) return
    if (!dirty.value) return cancel()
    if (drafts.value) {
      appSaving.value = true
      const next = await options.publish({ files: drafts.value })
      appSaving.value = false
      if (!next) return
      notify.done(`Published v${next.version}`, drop.value.visibility === "shared" ? "Everyone with the link sees it now." : "Only you can see it.")
      drafts.value = null
      options.onAppPublished?.()
      return
    }
    if (!docEdit.value) return
    docEdit.value.saving = true
    const next = await options.publish({ content: docEdit.value.text })
    if (!next) {
      if (docEdit.value) docEdit.value.saving = false
      return
    }
    notify.done("Published a new version", "The previous version stays in history.")
    docEdit.value = null
    await navigateTo(options.publicView ? `/d/${next.id}` : `/drops/${next.id}`)
  }

  /** A blank file in the app's drafts. Resolves the path, or null when cancelled. */
  async function addFile(path: string | null) {
    const clean = path?.replace(/^\/+/, "")
    if (!clean || !drafts.value) return null
    if (!(clean in drafts.value)) drafts.value = { ...drafts.value, [clean]: "" }
    return clean
  }

  return { docEdit, editorSource, drafts, editing, dirty, saving, start, cancel, save, addFile }
}
