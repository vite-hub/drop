import { DOC_WIDTHS, type DocWidth, planDocument } from "#shared/documents"
import type { FrameMessage } from "#shared/frame-messages"
import { embedDocument, injectRuntime, withVariantBar } from "#shared/plan-runtime"
import { appLocation, appPageFor, buildProjectDocument } from "#shared/project-bundle"
import { addRuntimeErrors } from "#shared/runtime-errors"
import type { DropComment, DropDetail, DropRuntimeError } from "#shared/types"
import type { ViewerTool } from "~/composables/useViewerAnnotations"
import type { CommentStyle } from "~/composables/usePreferences"
import type { Presence } from "~/composables/usePresence"

type RuntimeReport = {
  kind: Extract<FrameMessage, { type: "runtime-error" }>["kind"]
  message: string
  source?: string
  page?: string
}

export type ViewerVariants = Omit<Extract<FrameMessage, { type: "variants" }>, "type">
export type PickerCommand =
  | "show"
  | "prev"
  | "next"
  | "canvas"
  | "zoom-in"
  | "zoom-out"
  | "fit"
  | "reset"
  | "move"
  | "hand"
  | "hold"
  | "release"

export function useViewerFrame(options: {
  drop: Ref<DropDetail>
  frame: Readonly<Ref<HTMLIFrameElement | null>>
  app: ReturnType<typeof useAppFiles>
  pinned: Ref<DropComment[]>
  inset: Ref<number>
  bottom: Ref<number>
  width: Ref<DocWidth>
  zen?: Ref<boolean>
  annotations: ReturnType<typeof useViewerAnnotations>
  comments?: Ref<{ style: CommentStyle; me: { name: string; image: string | null } | null; only: string[] }>
  clickComments?: Ref<boolean>
  threadOverCard?: Ref<boolean>
  variantBar?: boolean
  variants?: Ref<ViewerVariants | null>
  arrow?: (key: "ArrowLeft" | "ArrowRight") => void
  presence?: Presence
  heading?: (id: string, copy: boolean) => void
  docAction?: (action: "markdown" | "download" | "pdf") => void
  docIntent?: (what: "markdown" | "folder") => void
  docCopied?: (ok: boolean, error?: string) => void
  openDrop?: (id: string) => void
  palette?: () => void
  toggleZen?: () => void
  escape?: () => boolean
  errors?: Ref<DropRuntimeError[]>
}) {
  const {
    drop,
    app: { files, pages, page, location },
    annotations,
  } = options
  const { copy } = useCopy()
  const colorMode = useColorMode()
  const mounted = useMounted()
  const dark = computed(() => colorMode.value === "dark")
  const isApp = computed(() => drop.value.kind === "app")
  const trashed = computed(() => drop.value.trashedAt !== null)

  const imageBlob = shallowRef<Blob>()
  const { base64: imageData } = useBase64(imageBlob)
  onMounted(async () => {
    if (drop.value.kind !== "image" || !drop.value.url) return
    imageBlob.value = await $fetch<Blob>(drop.value.url, { responseType: "blob" }).catch((error: unknown) => {
      reportClientError("image-load", error, { drop: drop.value.id })
      return undefined
    })
  })

  const attached = useAttachmentData(drop)

  let startInset = 0
  watch(options.inset, (value) => (startInset = value), { immediate: true, flush: "sync" })
  let startWidth: DocWidth = "readable"
  watch(options.width, (value) => (startWidth = value), { immediate: true, flush: "sync" })
  let startZen = false
  watch(
    () => options.zen?.value ?? false,
    (value) => (startZen = value),
    { immediate: true, flush: "sync" },
  )
  const variantBar = (html: string) =>
    options.variantBar && html ? withVariantBar(html, `${drop.value.id}@${drop.value.version}`) : html
  const readPages = shallowRef(new Map<string, string | null>())
  watch([() => drop.value.id, () => drop.value.version], () => {
    readPages.value = new Map()
  })
  const unread = (path: string) =>
    !!drop.value.contentGrant &&
    pages.value.includes(path) &&
    files.value[path] === undefined &&
    !readPages.value.has(path)
  function appDocument(path: string) {
    if (unread(path)) return ""
    const html = readPages.value.get(path)
    const source = html != null ? { ...files.value, [path]: html } : files.value
    return injectRuntime(buildProjectDocument(source, path), dark.value, startInset, true)
  }
  const srcdoc = computed(() => variantBar(frameContent()))
  function frameContent() {
    const { kind } = drop.value
    if (!mounted.value || kind === "folder" || kind === "site" || kind === "board" || kind === "link") return ""
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
        startZen,
      )
    if (!attached.ready.value) return ""
    return planDocument(
      kind,
      attached.inline(drop.value.content ?? ""),
      dark.value,
      attached.inline(drop.value.html ?? ""),
      startInset,
      startWidth,
      startZen,
    )
  }

  const contentOrigin = computed(() => drop.value.contentOrigin)
  const hostUrl = () => (contentOrigin.value ? contentOrigin.value + (isApp.value ? location.value : "/") : undefined)
  const frameSrc = ref(hostUrl())
  const frameKey = ref(0)
  let frameDocument = ""
  let frameLocation = ""
  let asked = false
  function reloadFrame() {
    frameSrc.value = hostUrl()
    frameKey.value++
    asked = false
  }
  function openPath(path: string) {
    if (!contentOrigin.value) return
    frameSrc.value = contentOrigin.value + path
    frameKey.value++
    asked = false
  }

  function followFrame(path: string) {
    if (!isApp.value) return
    const at = appLocation(path)
    if (at === null) return
    frameLocation = at
    location.value = at
  }

  const variants = options.variants ?? shallowRef<ViewerVariants | null>(null)
  const picker = (command: PickerCommand, index?: number) => send({ type: "picker", do: command, index })

  const frameTool = ref<ViewerTool>("browse")
  const held = () => !ready.value || annotations.frameTool.value === "browse" || frameTool.value !== "browse"
  async function whenHeld() {
    if (held()) return
    await until(frameTool).toMatch(held, { timeout: 400 })
  }

  const unplaced = ref(new Set<string>())

  let runtimeReports: RuntimeReport[] = []
  const flushRuntimeReports = useDebounceFn(async () => {
    const errors = runtimeReports.splice(0, 20)
    runtimeReports = []
    if (!errors.length) return
    const { id, version } = drop.value
    const stored = await $fetch(`/api/drops/${id}/errors`, { method: "POST", body: { version, errors } }).then(
      () => true,
      (error: unknown) => reportClientError("runtime-errors", error, { drop: id }),
    )
    if (stored && options.errors && drop.value.id === id && drop.value.version === version)
      options.errors.value = addRuntimeErrors(options.errors.value, errors, Date.now())
  }, 2000)

  const embedLinks = computed(() => {
    if (drop.value.kind !== "markdown") return new Set<string>()
    const template = globalThis.document?.createElement("template")
    if (!template) return new Set<string>()
    template.innerHTML = drop.value.html ?? ""
    return new Set(
      Array.from(template.content.querySelectorAll("figure.drop-embed[data-drop-embed]"), (box) =>
        box.getAttribute("data-drop-embed"),
      ),
    )
  })
  const embeds = new Map<string, Promise<{ html: string } | { error: string }>>()
  function embedded(link: string) {
    let embed = embeds.get(link)
    if (!embed) {
      embed = $fetch<DropDetail>(`/api/drops/${encodeURIComponent(link)}`).then(
        (found) =>
          found.kind === "html" && found.content
            ? { html: found.content }
            : { error: `“${found.title}” isn't an HTML drop, so it can't show inside a doc. Only HTML drops can.` },
        () => ({ error: "This drop is private, expired, or deleted, so it can't show here." }),
      )
      embeds.set(link, embed)
    }
    return embed
  }

  const reading = new Map<string, string[]>()

  const quiz = useViewerQuiz(drop, (message) => send(message))
  const { ready, send } = useDropFrame(options.frame, contentOrigin, (message, box) => {
    switch (message.type) {
      case "comark-quiz:ready":
      case "comark-quiz:answer":
        if (drop.value.kind === "markdown") quiz.receive(message)
        return
      case "runtime-error":
        if (!isApp.value && drop.value.kind !== "html" && message.kind !== "load" && message.message)
          reportClientError(`frame-${message.kind}`, message.message, {
            drop: drop.value.id,
            ...(message.source ? { source: message.source } : {}),
          })
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
        followFrame(message.path)
        if (isApp.value && unread(page.value))
          return send({ type: "read", page: page.value, grant: drop.value.contentGrant })
        frameDocument = srcdoc.value
        return send({ type: "document", html: frameDocument, grant: drop.value.contentGrant })
      case "page": {
        if (!isApp.value || !unread(message.page)) return
        readPages.value = new Map(readPages.value).set(message.page, message.html ?? null)
        for (const id of reading.get(message.page) ?? [])
          send({ type: "document", id, html: appDocument(message.page) })
        reading.delete(message.page)
        if (message.page !== page.value) return
        frameDocument = srcdoc.value
        return send({ type: "document", html: frameDocument })
      }
      case "frame-request": {
        if (!isApp.value) return
        const target = appPageFor(pages.value, message.path)
        if (!unread(target)) return send({ type: "document", id: message.id, html: appDocument(target) })
        reading.set(target, [...(reading.get(target) ?? []), message.id])
        return send({ type: "read", page: target })
      }
      case "location":
        followFrame(message.path)
        frameDocument = srcdoc.value
        return
      case "navigate":
        if (isApp.value) page.value = message.path
        return
      case "copy":
        return void copy(message.text)
      case "heading":
        if (drop.value.kind === "markdown") options.heading?.(message.id, message.copy === true)
        return
      case "doc-action":
        if (drop.value.kind === "markdown") options.docAction?.(message.action)
        return
      case "doc-open":
        if (drop.value.kind === "markdown") options.openDrop?.(message.id)
        return
      case "doc-intent":
        if (drop.value.kind === "markdown") options.docIntent?.("markdown")
        return
      case "doc-folder":
        if (drop.value.kind === "markdown") options.docIntent?.("folder")
        return
      case "doc-copied":
        if (drop.value.kind === "markdown") options.docCopied?.(message.ok, message.error)
        return
      case "pointer":
        return options.presence?.point(message.at)
      case "activity":
        return options.presence?.activity()
      case "files":
        for (const path of message.paths)
          void attached.load(path).then((data) => data && send({ type: "file-data", path, data }))
        return
      case "embeds": {
        if (drop.value.kind !== "markdown") return
        const requestedId = drop.value.id
        for (const link of message.links) {
          if (!embedLinks.value.has(link)) continue
          void embedded(link).then((embed) => {
            if (drop.value.id !== requestedId || !embedLinks.value.has(link)) return
            return send({
              type: "embed-data",
              link,
              ...("html" in embed ? { html: embedDocument(embed.html, dark.value) } : embed),
            })
          })
        }
        return
      }
      case "unplaced":
        unplaced.value = new Set(message.ids)
        return
      case "tool":
        frameTool.value = message.tool
        return
      case "ready":
        variants.value = null
        frameTool.value = "browse"
        if (options.variantBar) send({ type: "picker", do: "sync" })
        return
      case "variants":
        if (options.variantBar) variants.value = { ...message }
        return
      case "key":
        if (message.key === "meta_k") return options.palette?.()
        if (message.key === "z")
          return isApp.value && (message.tool ?? "browse") === "browse" ? undefined : options.toggleZen?.()
        if (message.key === "Escape" && options.escape?.()) return
        if (message.key === "ArrowLeft" || message.key === "ArrowRight") return options.arrow?.(message.key)
        return annotations.receive(message, box)
      case "selection":
      case "image":
      case "area":
      case "area-shot":
      case "marker":
      case "marks":
      case "mark-retry":
      case "draft-place":
      case "page-click":
        annotations.receive(message, box)
    }
  })
  onMounted(() => contentOrigin.value && send({ type: "hello" }))
  watch([srcdoc, () => isApp.value && location.value], ([value, at], [before]) => {
    if (!contentOrigin.value && value === before) return
    if (
      contentOrigin.value &&
      (asked ? value === frameDocument && (at === false || at === frameLocation) : frameSrc.value === hostUrl())
    )
      return
    ready.value = false
    variants.value = null
    if (contentOrigin.value) reloadFrame()
  })
  watch([ready, options.pinned], () => {
    if (ready.value)
      send({
        type: "markers",
        markers: options.pinned.value.map(
          ({
            id,
            n,
            kind,
            selector,
            ox,
            oy,
            ow,
            oh,
            quote,
            suggestion,
            ink,
            label,
            resolved,
            version,
            authorName,
            authorImage,
            body,
            replies,
            delivery,
          }) => ({
            id,
            n,
            kind,
            selector,
            ox,
            oy,
            ow,
            oh,
            quote,
            suggestion,
            ink,
            label,
            resolved,
            earlier: version < drop.value.version,
            author: authorName,
            image: authorImage,
            body,
            replies: replies.length,
            ...(delivery ? { waiting: delivery.status } : {}),
          }),
        ),
      })
  })
  const openThread = computed(() =>
    annotations.popover.value?.type === "thread" ? annotations.popover.value.id : null,
  )
  watch(
    [ready, openThread, () => options.threadOverCard?.value],
    () =>
      ready.value && send({ type: "active", id: openThread.value, covered: options.threadOverCard?.value ?? false }),
  )
  watch(
    [ready, annotations.frameTool, () => options.clickComments?.value],
    () =>
      ready.value &&
      send({
        type: "tool",
        tool: annotations.frameTool.value,
        pointComments: drop.value.kind === "image",
        clickComments: options.clickComments?.value ?? false,
        pen: annotations.penStyle.value,
      }),
  )
  watch(
    annotations.penStyle,
    (pen, before) =>
      ready.value &&
      send({
        type: "pen",
        tool: pen.tool,
        ...(pen.color !== before.color ? { color: pen.color } : {}),
        ...(pen.width !== before.width ? { width: pen.width } : {}),
      }),
  )
  if (options.presence) {
    const { cursors, sharing } = options.presence
    watch(
      [ready, cursors, sharing],
      () =>
        ready.value &&
        send({ type: "cursors", cursors: cursors.value.map((cursor) => ({ ...cursor })), share: sharing.value }),
    )
  }
  watch(
    [ready, () => ({ ...annotations.overlays }), () => options.comments?.value],
    () => ready.value && send({ type: "view", ...annotations.overlays, ...options.comments?.value }),
  )
  watch(annotations.draftingArea, (now, before) => before && !now && send({ type: "clear-area" }))
  watch(
    [ready, options.inset, options.bottom],
    () => ready.value && send({ type: "inset", right: options.inset.value, bottom: options.bottom.value }),
  )
  watch([ready, options.width], () => ready.value && send({ type: "width", column: DOC_WIDTHS[options.width.value] }))
  watch(
    [ready, () => options.zen?.value ?? false],
    ([loaded, zen]) => loaded && drop.value.kind === "markdown" && send({ type: "zen", on: zen }),
  )
  useEventListener("keydown", (event: KeyboardEvent) => {
    const scroll = ready.value && frameScrollKey(event)
    if (scroll) send({ type: "scroll-key", ...scroll })
  })

  const frameScheme = computed(() => (dark.value && ready.value ? "dark" : "light"))

  return {
    srcdoc,
    contentOrigin,
    frameSrc,
    frameKey,
    frameScheme,
    ready,
    send,
    unplaced,
    openPath,
    variants,
    picker,
    whenHeld,
  }
}
