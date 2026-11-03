import {
  type CommentsTransport,
  type CommentThread,
  type CommentUser,
  createCommentsClient,
} from "vite-hub/comments/client"
import { provideComments, useComments } from "vite-hub/ui/headless"
import type { DropComment } from "#shared/types"
import type { Sent } from "~/composables/useDrop"
import { attachmentUrls, dropSubject, toThread } from "~/utils/comment-threads"

/** What a viewer action sent, or its failure as the error the comment parts show under the box. */
async function settled<T>(sent: Promise<Sent<T>>) {
  const result = await sent
  if (!("value" in result)) throw new Error(result.error ?? "That didn't go through. Try again.")
  return result.value
}

/**
 * The comments of the open drop for vite-hub/ui's comment parts (CommentPanel, CommentThread, CommentComposer): a
 * ViteHub comments client over Drop's own comment routes, which check Drop's sharing and take guests on a "Can
 * comment" link. The threads are the ones the viewer already holds (useDrop), so the pins in the frame and the parts
 * show the same list; a change from either side shows in both.
 *
 * `source` is what the dock lists: the drop's comments, or an image's in the lightbox. `page` is the app page a new
 * comment on the whole page is about.
 */
function useDropComments(options: {
  source: () => DropComment[]
  page: () => string | undefined
  site?: () => string | null
}) {
  const state = injectDrop()!
  const { data: me } = useMe()
  const dropId = () => state.drop.data.value?.id ?? ""
  const subject = computed(() => dropSubject(dropId(), options.site?.()))
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
    // Whom "@" may name here: ViteHub Comments' people that may read this drop (server/api/drops/[id]/people.get.ts).
    users: ({ query }) =>
      user.value
        ? $fetch<CommentUser[]>(`/api/drops/${dropId()}/people`, { query: { q: query } })
        : Promise.resolve([]),
  }

  // The client and the parts keep their own copy of the threads. Whatever changes the viewer's list (a send, a new
  // version, the lightbox) has them read it again.
  const client = createCommentsClient({ transport, user: user.value, refreshOnFocus: false })
  watch([options.source, subject], () => void client.refresh().catch(() => undefined), { flush: "post" })
  const comments = useComments({ client, subject, user, hotkey: false })
  // A CommentPanel handed `comments` keeps it to itself; its composer finds "@" people through the context.
  provideComments(comments)

  const urls = computed(() => attachmentUrls(options.source()))
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
    upload: async (list: File[]) => stash(list),
    attachmentUrl: (key: string) => urls.value.get(key),
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
