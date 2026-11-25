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

async function settled<T>(sent: Promise<Sent<T>>) {
  const result = await sent
  if (!("value" in result)) throw new Error(result.error ?? "That didn't go through. Try again.")
  return result.value
}

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
        .find((comment) => ("threadId" in input ? comment.id === input.threadId : comment.n === input.n))
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
    users: (input) => (user.value ? rest.users({ ...input, subject: subject.value }) : Promise.resolve([])),
  }

  const mine = (author: CommentUser) => Boolean(user.value && author.id === user.value.id)
  const can: CommentCan = (action, { thread, message }) => {
    const shown = drop()
    if (!shown) return false
    if (action === "reply") return shown.canComment && (!thread.delivery || thread.delivery.error?.status !== 401)
    if (action === "resolve") return !thread.delivery && (shown.isOwner || mine(thread.author))
    if (!message || message.delivery) return false
    if (action === "edit") return mine(message.author)
    return shown.isOwner || mine(message.author)
  }

  const client = createCommentsClient({ transport, user: user.value, refreshOnFocus: false })
  watch(
    [options.source, subject],
    () => void client.refresh().catch((error: unknown) => reportClientError("comments-refresh", error)),
    { flush: "post" },
  )
  const comments = useComments({ client, subject, user, can, hotkey: false })

  const images = computed(() => attachmentsOf(options.source()))
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
    attachmentUrl: (key: string) => {
      const file = images.value.get(key)
      const url = key.startsWith(LOCAL_ATTACHMENT) && file ? file.url : rest.attachmentUrl(key)
      return { url, ...(file ? { name: file.filename, type: file.contentType } : {}) }
    },
    thread: (comment: DropComment): CommentThread => toThread(comment, subject.value),
    reply: async (id: string, body: string, mentions: string[], attached: File[]) => {
      await transport.reply({ threadId: id, body, mentions, attachments: stash(attached) })
    },
    edit: (id: string, messageId: string, body: string, mentions: string[]) =>
      transport.edit({ threadId: id, messageId, body, mentions }),
    users: (query: string) => transport.users({ query }),
  }
}

export const [provideDropComments, injectDropComments] = createInjectionState(useDropComments)
