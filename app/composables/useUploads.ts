import type { DropSummary } from "#shared/types"

/**
 * Files someone adds to a list of drops, uploaded one after another: from the file picker, dropped on `root`, or handed
 * to `uploadFiles`. They go into `folder`, or to the top without one. On a wide screen the last one shows in the list's
 * preview (`selected`); on a narrow one a single file opens instead.
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
  const uploading = ref(0)
  async function uploadFiles(files: File[]) {
    if (options.enabled?.() === false || !files.length) return
    uploading.value = files.length
    let last: { id: string } | undefined
    for (const file of files) {
      last = (await upload(file, options.folder?.())) ?? last
      uploading.value--
    }
    if (!last) return
    if (options.wide.value) options.selected.value = last.id
    else if (files.length === 1) await navigateTo(`/drops/${last.id}`)
  }
  const picker = useFileDialog({ multiple: true, reset: true })
  picker.onChange((files) => void uploadFiles([...(files ?? [])]))
  const { isOverDropZone } = useDropZone(root, { multiple: true, onDrop: (files) => void uploadFiles(files ?? []) })
  return { uploading, uploadFiles, openPicker: picker.open, isOverDropZone }
}
