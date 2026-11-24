import {
  deferImages,
  deferMedia,
  deferPdfs,
  embeddedImagePaths,
  embeddedMediaPaths,
  embeddedPdfPaths,
  FILE_LINK,
  localPdf,
} from "#shared/embedded-images"
import type { DropDetail } from "#shared/types"

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
  const pdfs = computed(() => embeddedPdfPaths(drop.value.html ?? "", host))
  const fetchImage = cached((path) => readBlob(path).then(blobDataUrl))
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
  const defer = (html: string) => deferPdfs(deferMedia(deferImages(html, images.value), media.value), host)
  const load = (path: string): Promise<string | Blob | null> =>
    images.value.includes(path)
      ? fetchImage(path)
      : media.value.includes(path) || pdfs.value.includes(path)
        ? fetchMedia(path)
        : Promise.resolve(null)
  const pdfOf = (src: string) => localPdf(src, host)
  return { ready: computed(() => data.value !== null), deferred, inline, defer, load, pdfs, pdfOf }
}
