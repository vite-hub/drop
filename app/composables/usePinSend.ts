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
    images: { files: Readonly<Ref<File[]>>; add: (files: Iterable<File>) => void }
    scope: Readonly<Ref<string>>
    clear: () => void
  }
  page: () => string | undefined
  shown: () => File | null
  shotFor: (id: number | undefined) => Promise<File | null>
  ready: () => boolean
  prepare: () => Promise<unknown>
  addComment: (
    place: CommentPlace,
    body: string,
    files: File[],
    mentions: string[],
    deferredFiles?: Promise<File[]>,
  ) => Promise<Sent<DropComment>>
  closed: () => void
  sent: (id: string) => void
  fail: (reason: string | undefined) => void
}

const sameItems = <T>(before: T[], after: T[]) =>
  before.length === after.length && before.every((item, index) => item === after[index])

export function usePinSend(options: PinSendOptions) {
  const { popover, draft } = options
  let preparing = false

  async function submit(body: string, files: File[] = [], mentions: string[] = []) {
    const open = popover.value
    if (open?.type !== "new" || preparing) return
    const picked = [...files]
    const tagged = [...mentions]
    if (!options.ready()) {
      const scope = draft.scope.value
      const text = draft.body.value
      const attachments = [...draft.images.files.value]
      const taggedDraft = [...draft.mentions.value]
      const suggestion = open.pending.suggestion
      const shown = options.shown()
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
      const currentFiles = draft.images.files.value
      const screenshot = options.shown()
      const arrived = screenshot && screenshot !== shown && currentFiles.includes(screenshot) ? screenshot : null
      if (
        draft.body.value !== text ||
        open.pending.suggestion !== suggestion ||
        !sameItems(taggedDraft, draft.mentions.value) ||
        !sameItems(attachments, arrived ? currentFiles.filter((file) => file !== arrived) : currentFiles)
      )
        return
      if (arrived && picked.length < MAX_COMMENT_IMAGES) picked.push(arrived)
    }
    send(open, body, picked, tagged)
  }

  function send(open: NewComment, body: string, picked: File[], mentions: string[]) {
    const deferredFiles =
      open.shot === undefined || options.shown() || picked.length >= MAX_COMMENT_IMAGES
        ? undefined
        : options.shotFor(open.shot).then((shot) => (shot ? [shot] : []))
    const page = options.page()
    const place = { ...open.pending, ...(page === undefined ? {} : { page }) }
    draft.clear()
    draft.mentions.value = []
    popover.value = null
    options.closed()
    void kept(open, options.addComment(place, body, picked, mentions, deferredFiles), body, picked, mentions)
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
    if (popover.value || draft.body.value) return
    draft.body.value = body
    draft.mentions.value = mentions
    draft.images.add(picked)
    popover.value = open
    options.fail(sent.error)
  }

  return { submit }
}
