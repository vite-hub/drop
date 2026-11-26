import { MAX_COMMENT_IMAGES } from "#shared/schemas"
import type { DropComment } from "#shared/types"
import type { CommentPlace } from "~/utils/comment-outbox"
import type { Sent } from "./useDrop"
import type { ViewerPopover } from "./useViewerAnnotations"

type NewComment = Extract<ViewerPopover, { type: "new" }>

export interface PinSendOptions {
  popover: Ref<ViewerPopover | null>
  draft: {
    body: Ref<string>
    mentions: Ref<string[]>
    images: { add: (files: Iterable<File>) => void }
    scope: Readonly<Ref<string>>
    clear: () => void
  }
  /** The app page the comment is on, for an app drop. */
  page: () => string | undefined
  /** The composer's screenshot once it has joined the draft, before Send. */
  shown: () => File | null
  shotFor: (id: number | undefined) => Promise<File | null>
  /** Whether the outbox can take a comment in this tick; `prepare` waits until it can, or throws why not. */
  ready: () => boolean
  prepare: () => Promise<unknown>
  addComment: (
    place: CommentPlace,
    body: string,
    files: File[] | Promise<File[]>,
    mentions: string[],
  ) => Promise<Sent<DropComment>>
  /** The composer closed on Send: clear the page's selection. */
  closed: () => void
  /** The comment shows, waiting: point at it. */
  sent: (id: string) => void
  /** The comment couldn't be kept; the composer is open again with it. */
  fail: (reason: string | undefined) => void
}

/**
 * Send for a new comment's composer. Once the outbox is ready, Send closes the composer, empties the draft and lists
 * the comment as waiting in the same tick; its screenshot and the network finish behind it, so the next comment can
 * start at once. A comment the outbox couldn't save shows as failed, with Retry, and keeps its text.
 */
export function usePinSend(options: PinSendOptions) {
  const { popover, draft } = options
  let preparing = false

  async function submit(body: string, files: File[] = [], mentions: string[] = []) {
    const open = popover.value
    if (open?.type !== "new" || preparing) return
    if (!options.ready()) {
      const scope = draft.scope.value
      preparing = true
      try {
        await options.prepare()
      } catch (error) {
        if (popover.value === open) options.fail(error instanceof Error ? error.message : undefined)
        return
      } finally {
        preparing = false
      }
      if (popover.value !== open || draft.scope.value !== scope) return
    }
    send(open, body, [...files], [...mentions])
  }

  function send(open: NewComment, body: string, picked: File[], mentions: string[]) {
    // A screenshot that hasn't joined the draft yet follows the comment, as it would have joined the draft.
    const files =
      open.shot === undefined || options.shown() || picked.length >= MAX_COMMENT_IMAGES
        ? picked
        : options.shotFor(open.shot).then((shot) => (shot ? [...picked, shot] : picked))
    const page = options.page()
    const place = { ...open.pending, ...(page === undefined ? {} : { page }) }
    draft.clear()
    draft.mentions.value = []
    popover.value = null
    options.closed()
    void kept(open, options.addComment(place, body, files, mentions), body, picked, mentions)
  }

  async function kept(
    open: NewComment,
    sending: Promise<Sent<DropComment>>,
    body: string,
    picked: File[],
    mentions: string[],
  ) {
    const sent = await sending
    if ("value" in sent) return options.sent(sent.value.id)
    // Nothing was kept. Put the comment back, unless the reader has started another one.
    if (popover.value || draft.body.value) return
    draft.body.value = body
    draft.mentions.value = mentions
    draft.images.add(picked)
    popover.value = open
    options.fail(sent.error)
  }

  return { submit }
}
