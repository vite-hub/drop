import { DOC_WIDTHS, type DocWidth, planDocument } from "#shared/documents"
import type { FrameMessage } from "#shared/frame-messages"
import { injectRuntime } from "#shared/plan-runtime"
import { buildProjectDocument, pageAt, pageUrl } from "#shared/project-bundle"
import type { DropComment, DropDetail } from "#shared/types"

type RuntimeReport = {
  kind: Extract<FrameMessage, { type: "runtime-error" }>["kind"]
  message: string
  source?: string
  page?: string
}

/**
 * The frame the drop renders in, and everything that goes over its postMessage bridge (useDropFrame): the document
 * it shows, the app page it navigated to, the comment pins, the toolbar's tool and overlays, the room the floating
 * panel takes, and the errors the page reports. What the reader points at goes on to the annotations.
 */
export function useViewerFrame(options: {
  drop: Ref<DropDetail>
  frame: Readonly<Ref<HTMLIFrameElement | null>>
  /** The app's files and the page showing (useAppFiles). */
  app: ReturnType<typeof useAppFiles>
  /** The comments on the page showing that the frame pins. */
  pinned: Ref<DropComment[]>
  /** Room the floating panel takes on the right, in pixels. */
  inset: Ref<number>
  /** How wide a Markdown doc's text runs. */
  width: Ref<DocWidth>
  annotations: ReturnType<typeof useViewerAnnotations>
}) {
  const {
    drop,
    app: { files, pages, page },
    annotations,
  } = options
  const { copy } = useCopy()
  const colorMode = useColorMode()
  const mounted = useMounted()
  const dark = computed(() => colorMode.value === "dark")
  const isApp = computed(() => drop.value.kind === "app")
  const trashed = computed(() => drop.value.trashedAt !== null)

  // Images load into the sandbox as data URLs: the opaque-origin frame can't send your session cookie.
  const imageBlob = shallowRef<Blob>()
  const { base64: imageData } = useBase64(imageBlob)
  onMounted(async () => {
    if (drop.value.kind !== "image" || !drop.value.url) return
    imageBlob.value = await $fetch<Blob>(drop.value.url, { responseType: "blob" }).catch(() => undefined)
  })

  const attached = useAttachmentData(drop)

  // A plain variable, not a ref: the documents read it when they're built, and opening the panel later must not
  // rebuild (and reload) them. The "inset" message moves the text from there, and "width" widens it.
  let startInset = 0
  watch(options.inset, (value) => (startInset = value), { immediate: true, flush: "sync" })
  let startWidth: DocWidth = "readable"
  watch(options.width, (value) => (startWidth = value), { immediate: true, flush: "sync" })
  const appDocument = (path: string) =>
    injectRuntime(buildProjectDocument(files.value, path), dark.value, startInset, true)
  // Built only once mounted: the server can't know the reader's color mode, and a light document in a dark page paints
  // the frame white until the dark one replaces it. The panel's room goes in too (startInset), so a doc opened with the
  // panel showing doesn't slide left once it loads.
  const srcdoc = computed(() => {
    const { kind } = drop.value
    // A site review shows the live site itself (ViewerSite), not a document.
    if (!mounted.value || kind === "folder" || kind === "site" || kind === "board") return ""
    if (kind === "app") return appDocument(page.value)
    if (kind === "image")
      return imageData.value ? planDocument("image", imageData.value, dark.value, "", startInset) : ""
    if (attached.deferred.value)
      return planDocument(
        kind,
        drop.value.content ?? "",
        dark.value,
        attached.defer(drop.value.html ?? ""),
        startInset,
        startWidth,
      )
    if (!attached.ready.value) return ""
    return planDocument(
      kind,
      attached.inline(drop.value.content ?? ""),
      dark.value,
      attached.inline(drop.value.html ?? ""),
      startInset,
      startWidth,
    )
  })

  // With a content origin, apps and HTML docs load its frame host at the page's own URL, and the document follows over
  // postMessage (see server/utils/content-origin.ts). Otherwise the document is the iframe's srcdoc, in an opaque origin.
  const contentOrigin = computed(() => drop.value.contentOrigin)
  const hostUrl = () =>
    contentOrigin.value ? contentOrigin.value + (isApp.value ? pageUrl(page.value) : "/") : undefined
  // Rendered with the page, so the frame host loads while the viewer's own script does. It asks for its document when
  // it loads; if the viewer wasn't listening yet, the hello once mounted (below) has it ask again.
  const frameSrc = ref(hostUrl())
  const frameKey = ref(0)
  /** The document the content frame shows. When the frame moves on its own, the viewer follows without a reload. */
  let frameDocument = ""
  /** Whether this frame load asked for its document yet. Until it does, a changed document needs no reload. */
  let asked = false
  function reloadFrame() {
    frameSrc.value = hostUrl()
    frameKey.value++
    asked = false
  }
  /** Loads `path` in the content frame, as if the app went there itself: a Slidev deck's presenter view, say. */
  function openPath(path: string) {
    if (!contentOrigin.value) return
    frameSrc.value = contentOrigin.value + path
    frameKey.value++
    asked = false
  }

  function pageFor(path: string) {
    let decoded = path
    try {
      decoded = decodeURIComponent(path)
    } catch {}
    return pageAt(pages.value, decoded)
  }

  /** A path no page matches gets 404.html, or index.html for single-page apps, like a static host. */
  const fallbackDocument = () => appDocument("404.html" in files.value ? "404.html" : "index.html")

  /** The content frame navigated by itself (a link, history.pushState, a reload): show the page it landed on. */
  function followFrame(path: string) {
    if (!isApp.value) return true
    const target = pageFor(path)
    if (target) page.value = target
    return target !== null
  }

  // Open comments carry over from earlier versions; the frame says which of them it couldn't place on this one.
  const unplaced = ref(new Set<string>())

  // What the page reports going wrong goes to the server in batches, for the agent's read_drop. Only apps and HTML pages
  // run their own code; a Markdown doc's errors would be Drop's.
  let runtimeReports: RuntimeReport[] = []
  const flushRuntimeReports = useDebounceFn(() => {
    const errors = runtimeReports.splice(0, 20)
    runtimeReports = []
    if (errors.length)
      $fetch(`/api/drops/${drop.value.id}/errors`, {
        method: "POST",
        body: { version: drop.value.version, errors },
      }).catch(() => {})
  }, 2000)

  const { ready, send } = useDropFrame(options.frame, contentOrigin, (message, box) => {
    switch (message.type) {
      case "runtime-error":
        if ((isApp.value || drop.value.kind === "html") && !trashed.value && message.message) {
          runtimeReports.push({
            kind: message.kind,
            message: message.message.slice(0, 500),
            source: message.source?.slice(0, 300),
            ...(isApp.value ? { page: page.value } : {}),
          })
          void flushRuntimeReports()
        }
        return
      case "host":
        asked = true
        frameDocument = followFrame(message.path) ? srcdoc.value : fallbackDocument()
        // The grant lets this app's origin serve it its other files (server/utils/app-files.ts).
        return send({ type: "document", html: frameDocument, grant: drop.value.contentGrant })
      case "frame-request": {
        if (!isApp.value) return
        const target = pageFor(message.path)
        return send({ type: "document", id: message.id, html: target ? appDocument(target) : fallbackDocument() })
      }
      case "location":
        if (followFrame(message.path)) frameDocument = srcdoc.value
        return
      case "navigate":
        if (isApp.value) page.value = message.path
        return
      case "copy":
        return void copy(message.text)
      case "images":
        // Each as soon as it's read, so the first one on screen doesn't wait for the rest.
        for (const path of message.paths)
          void attached.load(path).then((url) => url && send({ type: "image-data", path, url }))
        return
      case "unplaced":
        unplaced.value = new Set(message.ids)
        return
      case "ready":
        return
      case "selection":
      case "image":
      case "area":
      case "marker":
      case "key":
        annotations.receive(message, box)
    }
  })
  onMounted(() => contentOrigin.value && send({ type: "hello" }))
  watch(srcdoc, (value) => {
    // A frame that hasn't asked yet gets the document as it is then, unless it's loading another page's address.
    if (contentOrigin.value && (asked ? value === frameDocument : frameSrc.value === hostUrl())) return
    ready.value = false
    if (contentOrigin.value) reloadFrame()
  })
  watch([ready, options.pinned], () => {
    // `earlier`: the frame also checks that the element is still what the comment pointed at, not just in its place.
    if (ready.value)
      send({
        type: "markers",
        markers: options.pinned.value.map(
          ({ id, n, kind, selector, ox, oy, ow, oh, quote, label, resolved, version, authorName, authorImage }) => ({
            id,
            n,
            kind,
            selector,
            ox,
            oy,
            ow,
            oh,
            quote,
            label,
            resolved,
            earlier: version < drop.value.version,
            author: authorName,
            image: authorImage,
          }),
        ),
      })
  })
  watch(
    [ready, annotations.tool],
    () =>
      ready.value && send({ type: "tool", tool: annotations.tool.value, pointComments: drop.value.kind === "image" }),
  )
  watch(
    [ready, () => ({ ...annotations.overlays })],
    () => ready.value && send({ type: "view", ...annotations.overlays }),
  )
  watch(annotations.draftingArea, (now, before) => before && !now && send({ type: "clear-area" }))
  watch([ready, options.inset], () => ready.value && send({ type: "inset", right: options.inset.value }))
  watch([ready, options.width], () => ready.value && send({ type: "width", column: DOC_WIDTHS[options.width.value] }))

  return { srcdoc, contentOrigin, frameSrc, frameKey, ready, send, unplaced, openPath }
}
