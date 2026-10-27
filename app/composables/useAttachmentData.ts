import { deferImages, deferMedia, embeddedImagePaths, embeddedMediaPaths, FILE_LINK } from "#shared/embedded-images"
import type { DropDetail } from "#shared/types"

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    // loadend comes once, after the read succeeds or fails.
    const settle = () => {
      reader.removeEventListener("loadend", settle)
      if (reader.result === null || reader.result instanceof ArrayBuffer)
        reject(reader.error ?? new Error("Not a data URL"))
      else resolve(reader.result)
    }
    reader.addEventListener("loadend", settle)
    reader.readAsDataURL(blob)
  })

// A file's path never names other bytes, so the next version's same screenshot isn't fetched again.
const cached = <T>(read: (path: string) => Promise<T>) => {
  const fetched = new Map<string, Promise<T | null>>()
  return (path: string) => {
    let file = fetched.get(path)
    if (!file) {
      file = read(path).catch(() => {
        fetched.delete(path)
        return null
      })
      fetched.set(path, file)
    }
    return file
  }
}
const readBlob = (path: string) => $fetch<Blob>(path, { responseType: "blob" })

/**
 * A doc's embedded images as data URLs. The doc renders in an opaque-origin sandbox that can't send your session
 * cookie, so a private doc's own images would come back as not found; the viewer fetches them as you instead. That
 * covers its attachments and any other image on this Drop it links to, such as screenshots published as their own
 * drops next to it: behind an auth proxy the sandbox can't load those either.
 *
 * A Markdown doc shows at once: its images wait in the frame (`defer`) until it asks for them as they near the screen
 * (`load`). An HTML doc can use an image anywhere in its markup, so it waits until all of them are inlined (`inline`).
 * A Markdown doc's videos and audio wait the same way, and go to the frame as files, not data URLs.
 */
export function useAttachmentData(drop: Ref<DropDetail>) {
  const data = shallowRef<Record<string, string> | null>(null)
  const host = useRequestURL().host
  /** The /f/ paths of the images to inline. */
  const images = computed(() =>
    embeddedImagePaths(
      [drop.value.content ?? "", drop.value.html ?? ""],
      host,
      (drop.value.attachments ?? []).filter((file) => file.kind === "image").map((file) => new URL(file.url).pathname),
    ),
  )
  /** The /f/ paths of the videos and audio to hand in. */
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
      // A newer version's images may arrive first; a slower, older run must not overwrite them.
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
  /** The source with each embedded image's link swapped for its data URL. */
  const inline = (source: string) =>
    data.value ? source.replace(FILE_LINK, (match, path: string) => data.value![path] ?? match) : source
  /** A Markdown doc's HTML with its images, videos, and audio waiting for the frame to ask for them. */
  const defer = (html: string) => deferMedia(deferImages(html, images.value), media.value)
  /**
   * One of the doc's files the frame asked for: an image as a data URL, a video or audio as its bytes. Null for any
   * other path, or when it can't be read.
   */
  const load = (path: string): Promise<string | Blob | null> =>
    images.value.includes(path)
      ? fetchImage(path)
      : media.value.includes(path)
        ? fetchMedia(path)
        : Promise.resolve(null)
  return { ready: computed(() => data.value !== null), deferred, inline, defer, load }
}
