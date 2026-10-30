import { COMMENT_IMAGE_TYPES, MAX_COMMENT_IMAGES, MAX_FILE_BYTES } from "#shared/schemas"

/** One image picked for a comment, with the object URL its preview shows. */
export type ImagePick = { file: File; url: string }

const isImage = (file: File) => COMMENT_IMAGE_TYPES.some((type) => type === file.type)

/**
 * The images a comment or reply box will send: from its image button, a paste, or a drop on the box. At most
 * MAX_COMMENT_IMAGES of 4 MiB each, as the server takes them; `problem` says why one wasn't added. Previews are object
 * URLs, revoked when the image is removed, the box is cleared, or the box goes away.
 */
export function useImagePicks() {
  const picks = shallowRef<ImagePick[]>([])
  const problem = ref<string>()

  function add(files: Iterable<File>) {
    problem.value = undefined
    const next = [...picks.value]
    for (const file of files) {
      if (!isImage(file)) problem.value = "Images must be PNG, JPEG, WebP, or GIF."
      else if (file.size > MAX_FILE_BYTES) problem.value = `${file.name || "An image"} is over 4 MiB.`
      else if (next.length >= MAX_COMMENT_IMAGES) problem.value = `At most ${MAX_COMMENT_IMAGES} images.`
      else next.push({ file, url: URL.createObjectURL(file) })
    }
    picks.value = next
  }

  function remove(pick: ImagePick) {
    URL.revokeObjectURL(pick.url)
    picks.value = picks.value.filter((item) => item !== pick)
  }

  function clear() {
    for (const pick of picks.value) URL.revokeObjectURL(pick.url)
    picks.value = []
    problem.value = undefined
  }

  const dialog = useFileDialog({ accept: COMMENT_IMAGE_TYPES.join(","), multiple: true, reset: true })
  dialog.onChange((files) => files && add(files))

  /** A paste with images adds them; text pastes as usual. */
  function paste(event: ClipboardEvent) {
    const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"))
    if (!files.length) return
    event.preventDefault()
    add(files)
  }

  function drop(event: DragEvent) {
    const files = [...(event.dataTransfer?.files ?? [])]
    if (!files.length) return
    event.preventDefault()
    add(files)
  }

  onScopeDispose(clear)

  return {
    picks,
    problem,
    files: computed(() => picks.value.map((pick) => pick.file)),
    add,
    remove,
    clear,
    open: () => dialog.open(),
    paste,
    drop,
  }
}
