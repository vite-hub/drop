import type { DropDetail } from "#shared/types"

const FILE_LINK = /(?:https?:\/\/[^\s"'()<>]+)?(\/f\/[0-9a-f-]{36}\.[a-z0-9]{1,16})(?:\?raw)?/gi

const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.addEventListener("load", () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Not a data URL")))
  reader.addEventListener("error", () => reject(reader.error))
  reader.readAsDataURL(blob)
})

/**
 * A doc's embedded images as data URLs. The doc renders in an opaque-origin sandbox that can't send your session
 * cookie, so a private doc's own images would come back as not found; the viewer fetches them as you instead.
 */
export function useAttachmentData(drop: Ref<DropDetail>) {
  const data = shallowRef<Record<string, string> | null>(null)
  const images = computed(() => (drop.value.attachments ?? []).filter(file => file.kind === "image"))
  watch(() => images.value.map(file => file.url).join(" "), async (_, __, onCleanup) => {
    if (!images.value.length) {
      data.value = {}
      return
    }
    if (import.meta.server) return
    // A newer version's images may arrive first; a slower, older run must not overwrite them.
    let stale = false
    onCleanup(() => (stale = true))
    const entries = await Promise.all(images.value.map(async (file) => {
      const blob = await $fetch<Blob>(file.url, { responseType: "blob" }).catch(() => null)
      return blob ? [new URL(file.url).pathname, await dataUrl(blob)] as const : null
    }))
    if (!stale) data.value = Object.fromEntries(entries.filter(entry => entry !== null))
  }, { immediate: true })
  /** The source with each embedded image's link swapped for its data URL. */
  const inline = (source: string) => data.value ? source.replace(FILE_LINK, (match, path: string) => data.value![path] ?? match) : source
  return { ready: computed(() => data.value !== null), inline }
}
