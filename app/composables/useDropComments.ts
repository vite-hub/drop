import {
  type CommentsTransport,
  type CommentThread,
  type CommentUser,
  createCommentsClient,
  createRestTransport,
} from "vite-hub/comments/client"
import { type CommentCan, useComments } from "vite-hub/ui/headless"
import type { DropComment } from "#shared/types"
import type { Sent } from "~/composables/useDrop"

/** What a viewer action sent, or its failure as the error the comment parts show under the box. */
async function settled<T>(sent: Promise<Sent<T>>) {
  const result = await sent
  if (!("value" in result)) throw new Error(result.error ?? "That didn't go through. Try again.")
  return result.value
}

/**
 * The comments of the open drop for vite-hub/ui's comment parts (CommentPanel, CommentThread, CommentComposer).
 *
 * Threads go through Drop's own comment routes, which keep the anchor, the suggestion, and the screenshot Drop's viewer
 * draws, and answer the comments the viewer already holds (useDrop): the pins in the frame and the parts show the same
 * list, and a change from either side shows in both. Whom "@" names and the comment images go straight to ViteHub's
 * Comments API (`createRestTransport`), which asks server/comments.ts who may.
 *
 * `source` is what the dock lists: the drop's comments, or an image's in the lightbox. `page` is the app page a new
 * comment on the whole page is about.
 */
function useDropComments(options: { source: () => DropComment[]; page: () => string | undefined }) {
  const state = injectDrop()!
  const { data: me } = useMe()
  const rest = createRestTransport()
  const drop = () => state.drop.data.value
  const subject = computed(() => commentSubject(drop()))
  const user = computed<CommentUser | undefined>(() =>
    me.value
      ? { id: me.value.id, name: me.value.name, ...(me.value.image ? { image: me.value.image } : {}) }
      : undefined,
  )

  // Files a composer attached, until the comment that carries them is sent: Drop's routes take them with the comment.
  const files = new Map<string, File>()
  let next = 0
  const stash = (list: File[]) =>
    list.map((file) => {
      const key = `file:${++next}`
      files.set(key, file)
      return key
    })
  const take = (keys: readonly string[] | undefined) =>
    (keys ?? []).flatMap((key) => {
      const file = files.get(key)
      files.delete(key)
      return file ? [file] : []
    })

  const threadOf = (id: string) => {
    const comment = state.findComment(id)
    if (!comment) throw new Error("This comment is gone.")
    return toThread(comment, subject.value)
  }

  const transport: CommentsTransport = {
    list: async () => options.source().map((comment) => toThread(comment, subject.value)),
    get: async (input) => {
      const found = options
        .source()
        .find((comment) => ("id" in input ? comment.id === input.id : comment.n === input.n))
      return found ? toThread(found, subject.value) : null
    },
    async create(input) {
      const comment = await settled(
        state.addComment(
          {
            kind: "page",
            selector: "",
            ox: 0,
            oy: 0,
            ow: 0,
            oh: 0,
            ...(options.page() ? { page: options.page() } : {}),
          },
          input.body,
          take(input.attachments),
          input.mentions,
        ),
      )
      return toThread(comment, subject.value)
    },
    async reply(input) {
      await settled(state.addReply(input.threadId, input.body, take(input.attachments), input.mentions))
      return threadOf(input.threadId)
    },
    async edit(input) {
      await settled(state.editMessage(input.threadId, input.messageId, input.body, input.mentions))
      return threadOf(input.threadId)
    },
    async delete({ threadId, messageId }) {
      if (!messageId || state.findComment(threadId)?.messageId === messageId) {
        await state.removeComment(threadId)
        return null
      }
      await state.removeReply(threadId, messageId)
      return threadOf(threadId)
    },
    async resolve({ threadId }) {
      await state.resolveComment(threadId, true)
      return threadOf(threadId)
    },
    async reopen({ threadId }) {
      await state.resolveComment(threadId, false)
      return threadOf(threadId)
    },
    // Signed-out readers name nobody (server/comments.ts `canMention`), so they don't ask.
    users: (input) => (user.value ? rest.users({ ...input, subject: subject.value }) : Promise.resolve([])),
  }

  // As Drop's routes decide: whoever may comment replies; a thread's author or the drop's managers resolve it; authors
  // edit their own words; authors and managers delete them. The routes still check.
  const mine = (author: CommentUser) => Boolean(user.value && author.id === user.value.id)
  const can: CommentCan = (action, { thread, message }) => {
    const shown = drop()
    if (!shown) return false
    if (action === "reply") return shown.canComment
    if (action === "resolve") return shown.isOwner || mine(thread.author)
    if (!message) return false
    if (action === "edit") return mine(message.author)
    return shown.isOwner || mine(message.author)
  }

  // The client and the parts keep their own copy of the threads. Whatever changes the viewer's list (a send, a new
  // version, the lightbox) has them read it again.
  const client = createCommentsClient({ transport, user: user.value, refreshOnFocus: false })
  watch([options.source, subject], () => void client.refresh().catch(() => undefined), { flush: "post" })
  const comments = useComments({ client, subject, user, can, hotkey: false })

  const images = computed(() => attachmentsOf(options.source()))
  // The people the comments mention, so their "@" shows as a chip even to readers who can't look people up.
  const people = computed(() => {
    const named = new Map<string, CommentUser>()
    for (const comment of options.source())
      for (const person of comment.people)
        named.set(person.id, { id: person.id, name: person.name, ...(person.image ? { image: person.image } : {}) })
    return [...named.values()]
  })
  return {
    comments,
    user,
    people,
    can,
    upload: async (list: File[]) => stash(list),
    /** A comment image by its key (its drop id), served by ViteHub's Comments API to whoever may read the thread. */
    attachmentUrl: (key: string) => {
      const file = images.value.get(key)
      return { url: rest.attachmentUrl(key), ...(file ? { name: file.filename, type: file.contentType } : {}) }
    },
    /** The thread of a comment the viewer holds, for a CommentThread outside the panel. */
    thread: (comment: DropComment): CommentThread => toThread(comment, subject.value),
    /** Sends a reply from a CommentThread outside the panel; a failure keeps the text and says why. */
    reply: async (id: string, body: string, mentions: string[], attached: File[]) => {
      await transport.reply({ threadId: id, body, mentions, attachments: stash(attached) })
    },
    edit: (id: string, messageId: string, body: string, mentions: string[]) =>
      transport.edit({ threadId: id, messageId, body, mentions }),
    users: (query: string) => transport.users({ query }),
  }
}

/** DropViewer provides the drop's comments; the dock, the thread, and the composer inject them. */
export const [provideDropComments, injectDropComments] = createInjectionState(useDropComments)
