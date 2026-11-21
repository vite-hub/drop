import { deferImages, deferMedia, embeddedImagePaths, embeddedMediaPaths, FILE_LINK } from "#shared/embedded-images"
import type { DropDetail } from "#shared/types"

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    const settle = () => {
      reader.removeEventListener("loadend", settle)
      if (reader.result === null || reader.result instanceof ArrayBuffer)
        reject(reader.error ?? new Error("Not a data URL"))
      else resolve(reader.result)
    }
    reader.addEventListener("loadend", settle)
    reader.readAsDataURL(blob)
  })

const cached = <T>(read: (path: string) => Promise<T>) => {
  const fetched = new Map<string, Promise<T | null>>()
  return (path: string) => {
    let file = fetched.get(path)
    if (!file) {
      file = read(path).catch((error: unknown) => {
        reportClientError("attachment", error)
        fetched.delete(path)
        return null
      })
      fetched.set(path, file)
    }
    return file
  }
}
const readBlob = (path: string) => $fetch<Blob>(path, { responseType: "blob" })

export function useAttachmentData(drop: Ref<DropDetail>) {
  const data = shallowRef<Record<string, string> | null>(null)
  const host = useRequestURL().host
  const images = computed(() =>
    embeddedImagePaths(
      [drop.value.content ?? "", drop.value.html ?? ""],
      host,
      (drop.value.attachments ?? []).filter((file) => file.kind === "image").map((file) => new URL(file.url).pathname),
    ),
  )
  const media = computed(() =>
    embeddedMediaPaths(
      [drop.value.content ?? "", drop.value.html ?? ""],
      host,
      (drop.value.attachments ?? []).map((file) => new URL(file.url).pathname),
    ),
  )
  const fetchImage = cached((path) => readBlob(path).then(dataUrl))
  const fetchMedia = cached(readBlob)
  const deferred = computed(() => drop.value.kind === "markdown")
  watch(
    () => [deferred.value, images.value.join(" ")],
    async (_, __, onCleanup) => {
      if (deferred.value || !images.value.length) {
        data.value = {}
        return
      }
      if (import.meta.server) return
      let stale = false
      onCleanup(() => (stale = true))
      const entries = await Promise.all(
        images.value.map(async (path) => {
          const url = await fetchImage(path)
          return url ? ([path, url] as const) : null
        }),
      )
      if (!stale) data.value = Object.fromEntries(entries.filter((entry) => entry !== null))
    },
    { immediate: true },
  )
  const inline = (source: string) =>
    data.value ? source.replace(FILE_LINK, (match, path: string) => data.value![path] ?? match) : source
  const defer = (html: string) => deferMedia(deferImages(html, images.value), media.value)
  const load = (path: string): Promise<string | Blob | null> =>
    images.value.includes(path)
      ? fetchImage(path)
      : media.value.includes(path)
        ? fetchMedia(path)
        : Promise.resolve(null)
  return { ready: computed(() => data.value !== null), deferred, inline, defer, load }
}
