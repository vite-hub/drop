import { embeddedImagePaths, FILE_LINK } from "#shared/embedded-images"
import type { DropDetail } from "#shared/types"

const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  // loadend comes once, after the read succeeds or fails.
  const settle = () => {
    reader.removeEventListener("loadend", settle)
    if (reader.result === null || reader.result instanceof ArrayBuffer) reject(reader.error ?? new Error("Not a data URL"))
    else resolve(reader.result)
  }
  reader.addEventListener("loadend", settle)
  reader.readAsDataURL(blob)
})

/**
 * A doc's embedded images as data URLs. The doc renders in an opaque-origin sandbox that can't send your session
 * cookie, so a private doc's own images would come back as not found; the viewer fetches them as you instead. That
 * covers its attachments and any other image on this Drop it links to, such as screenshots published as their own
 * drops next to it: behind an auth proxy the sandbox can't load those either.
 */
export function useAttachmentData(drop: Ref<DropDetail>) {
  const data = shallowRef<Record<string, string> | null>(null)
  const host = useRequestURL().host
  /** The /f/ paths of the images to inline. */
  const images = computed(() => embeddedImagePaths([drop.value.content ?? "", drop.value.html ?? ""], host,
    (drop.value.attachments ?? []).filter(file => file.kind === "image").map(file => new URL(file.url).pathname)))
  watch(() => images.value.join(" "), async (_, __, onCleanup) => {
    if (!images.value.length) {
      data.value = {}
      return
    }
    if (import.meta.server) return
    // A newer version's images may arrive first; a slower, older run must not overwrite them.
    let stale = false
    onCleanup(() => (stale = true))
    const entries = await Promise.all(images.value.map(async (path) => {
      const blob = await $fetch<Blob>(path, { responseType: "blob" }).catch(() => null)
      return blob ? [path, await dataUrl(blob)] as const : null
    }))
    if (!stale) data.value = Object.fromEntries(entries.filter(entry => entry !== null))
  }, { immediate: true })
  /** The source with each embedded image's link swapped for its data URL. */
  const inline = (source: string) => data.value ? source.replace(FILE_LINK, (match, path: string) => data.value![path] ?? match) : source
  return { ready: computed(() => data.value !== null), inline }
}
