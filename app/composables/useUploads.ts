import type { DropSummary } from "#shared/types"

/**
 * A file on its way up, shown in the list before the server has its drop. `progress` is how much of it has gone, from 0
 * to 1, and null while it waits for the files before it. `preview` is a local URL for an image or a video, so its row
 * shows the file at once.
 */
export interface PendingUpload {
  key: number
  name: string
  type: string
  preview?: string
  progress: number | null
}

let lastKey = 0

/**
 * Files someone adds to a list of drops, uploaded one after another: from the file picker, dropped on `root`, or handed
 * to `uploadFiles`. They go into `folder`, or to the top without one. Each one waits in `pending` until its drop is in the
 * list, so the list shows it from the moment it's added. On a wide screen the last one shows in the list's preview
 * (`selected`); on a narrow one a single file opens instead.
 */
export function useUploads(
  root: Readonly<Ref<HTMLElement | null>>,
  options: {
    folder?: () => Pick<DropSummary, "id" | "title">
    enabled?: () => boolean
    wide: Ref<boolean>
    selected: Ref<string | null>
  },
) {
  const { upload } = useDropActions()
  const pending = ref<PendingUpload[]>([])
  const uploading = computed(() => pending.value.length)
  async function uploadFiles(files: File[]) {
    if (options.enabled?.() === false || !files.length) return
    const added = files.map((file) => ({
      file,
      row: {
        key: ++lastKey,
        name: file.name,
        type: file.type,
        preview: /^(image|video)\//.test(file.type) ? URL.createObjectURL(file) : undefined,
        progress: null,
      } satisfies PendingUpload,
    }))
    pending.value.push(...added.map(({ row }) => row))
    let last: { id: string } | undefined
    for (const { file, row } of added) {
      const at = () => pending.value.find((item) => item.key === row.key)
      const started = at()
      if (started) started.progress = 0
      last =
        (await upload(file, options.folder?.(), {
          onProgress: (fraction) => {
            const item = at()
            if (item) item.progress = fraction
          },
        })) ?? last
      pending.value = pending.value.filter((item) => item.key !== row.key)
      if (row.preview) URL.revokeObjectURL(row.preview)
    }
    if (!last) return
    if (options.wide.value) options.selected.value = last.id
    else if (files.length === 1) await navigateTo(`/drops/${last.id}`)
  }
  const picker = useFileDialog({ multiple: true, reset: true })
  picker.onChange((files) => void uploadFiles([...(files ?? [])]))
  const { isOverDropZone } = useDropZone(root, { multiple: true, onDrop: (files) => void uploadFiles(files ?? []) })
  onScopeDispose(() => pending.value.forEach((item) => item.preview && URL.revokeObjectURL(item.preview)))
  return { pending, uploading, uploadFiles, openPicker: picker.open, isOverDropZone }
}
