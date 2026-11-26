import { dropPath } from "#shared/links"
import type { CommentReply, DropComment, DropDetail, DropSummary, DropVersion } from "#shared/types"
import type { FetchContext } from "ofetch"
import * as v from "valibot"
import { replyMessageId } from "vite-hub/comments/client"
import type { CommentPlace, SiteCommentPlace } from "../utils/comment-outbox"

export type Sent<T> = { value: T } | { error?: string }

function useDrop(id: MaybeRefOrGetter<string>, version?: MaybeRefOrGetter<number | undefined>) {
  const notify = useNotify()
  const query = computed(() => (toValue(version) ? { v: toValue(version) } : {}))
  const drop = useApi<DropDetail>(() => `/api/drops/${toValue(id)}`, {
    key: () => keys.drop(toValue(id), toValue(version)),
    query,
  })
  let primaryComments = false
  const commentRead = (context: FetchContext) => {
    if (!primaryComments || typeof context.request !== "string") return
    context.request += "/refresh"
    context.options.method = "POST"
  }
  const preferPrimaryComments = () => {
    primaryComments = true
  }
  const comments = useApi<DropComment[]>(() => `/api/drops/${toValue(id)}/comments`, {
    key: () => keys.comments(toValue(id), toValue(version)),
    query,
    default: () => [],
    onRequest: commentRead,
  })

  const wrote = createEventHook<void>()

  const subject = () => ({ kind: "drop", id: toValue(id) })
  const app = useCommentsOutbox()
  app.attach({
    drop: () => toValue(id),
    async created(_requestId, comment) {
      if (comment) comments.data.value = [...comments.data.value.filter((item) => item.id !== comment.id), comment]
      else await Promise.all([comments.refresh(), refreshNuxtData(keys.review(toValue(id)))])
      void wrote.trigger()
    },
    replied(_requestId, threadId, reply) {
      setReplies(threadId, (replies) => [...replies.filter((item) => item.id !== reply.id), reply])
      void wrote.trigger()
    },
    refresh: () => Promise.all([comments.refresh(), refreshNuxtData(keys.review(toValue(id)))]),
  })
  const view = () => ({
    drop: toValue(id),
    author: app.author,
    accepted: app.accepted,
  })
  const replyIds = shallowRef<ReadonlyMap<string, string>>(new Map())
  watch(
    () => waitingReplies(comments.data.value, app.entries.value, view()),
    async (replies) => {
      const missing = replies.filter(([thread, requestId]) => !replyIds.value.has(replyKey(thread, requestId)))
      if (!missing.length) return
      const found = await Promise.all(
        missing.map(async ([thread, requestId]) => {
          const message = await replyMessageId(thread, requestId).catch(() => undefined)
          return message ? [[replyKey(thread, requestId), message] as const] : []
        }),
      )
      if (found.flat().length) replyIds.value = new Map([...replyIds.value, ...found.flat()])
    },
    { immediate: true },
  )
  const imageUrls = fileUrls()
  watch(app.entries, (entries) => imageUrls.keep(fileKeys(entries)))
  onScopeDispose(() => imageUrls.clear())
  const list = computed(() =>
    withOutbox(comments.data.value, app.entries.value, {
      ...view(),
      replyIds: replyIds.value,
      fileUrl: (key, file) => imageUrls.urlOf(key, file),
    }),
  )
  const findComment = (commentId: string) => list.value.find((comment) => comment.id === commentId)

  async function addComment(
    input: CommentPlace,
    body: string,
    files: File[] = [],
    mentions: string[] = [],
    deferredFiles?: Promise<File[]>,
  ): Promise<Sent<DropComment>> {
    const requestId = randomId()
    try {
      const displayed = drop.data.value
      const at = toValue(version)
      const revision = at ?? displayed?.version ?? 0
      const pinned = at ?? (displayed?.kind === "app" ? undefined : displayed?.version)
      const target = toValue(id)
      const inputSubject = subject()
      const client = app.ready() ?? (await app.writable())
      const thread = await client.create({
        subject: inputSubject,
        anchor: { kind: "page" },
        body,
        mentions,
        files,
        deferredFiles,
        requestId,
        metadata: targetMetadata({
          route: "comment",
          drop: target,
          ...(pinned ? { v: pinned } : {}),
          version: revision,
          place: input,
        }),
      })
      const comment = list.value.find((item) => item.requestId === requestId || item.id === thread.id)
      if (!comment) throw new Error("The comment didn't stay in this browser. Try again.")
      return { value: comment }
    } catch (error) {
      return { error: notify.problem(error, "Couldn't keep the comment") }
    }
  }

  async function addSiteComment(origin: string, place: SiteCommentPlace, body: string, files: Blob[]) {
    try {
      const inputSubject = subject()
      const revision = drop.data.value?.version ?? 0
      const client = app.ready() ?? (await app.writable())
      await client.create({
        subject: inputSubject,
        anchor: { kind: "page" },
        body,
        files,
        requestId: randomId(),
        metadata: targetMetadata({
          route: "review",
          drop: inputSubject.id,
          version: revision,
          origin,
          place,
        }),
      })
      return true
    } catch (error) {
      notify.fail("Couldn't keep the comment", error)
      return false
    }
  }

  const waiting = (commentId: string, messageId = commentId) => {
    const comment = findComment(commentId)
    if (!comment) return false
    if (comment.messageId === messageId) return Boolean(comment.delivery)
    return Boolean(comment.replies.find((reply) => reply.id === messageId)?.delivery)
  }
  async function discard(messageId: string, title: string) {
    if (await app.discard(messageId)) return
    notify.alert(title, "It's on its way to the server. Delete it once it's there.")
  }

  async function resolveComment(commentId: string, resolved: boolean) {
    if (waiting(commentId)) return
    const before = comments.data.value
    const resolvedAt = (comment: DropComment) =>
      resolved ? Math.max(Date.now(), ...comment.replies.map((reply) => reply.createdAt)) : null
    comments.data.value = before.map((comment) =>
      comment.id === commentId ? { ...comment, resolved, resolvedAt: resolvedAt(comment) } : comment,
    )
    try {
      await $fetch(`/api/comments/${commentId}`, { method: "PATCH", body: { resolved } })
      void wrote.trigger()
    } catch (error) {
      comments.data.value = before
      notify.fail("Couldn't update the comment", error)
    }
  }

  async function removeComment(commentId: string) {
    if (waiting(commentId)) return discard(commentId, "Couldn't delete the comment")
    try {
      await $fetch(`/api/comments/${commentId}`, { method: "DELETE" })
      comments.data.value = comments.data.value.filter((comment) => comment.id !== commentId)
      void wrote.trigger()
    } catch (error) {
      notify.fail("Couldn't delete the comment", error)
    }
  }

  const setReplies = (commentId: string, change: (replies: CommentReply[]) => CommentReply[]) =>
    (comments.data.value = comments.data.value.map((comment) =>
      comment.id === commentId ? { ...comment, replies: change(comment.replies) } : comment,
    ))

  async function addReply(
    commentId: string,
    body: string,
    files: File[] = [],
    mentions: string[] = [],
  ): Promise<Sent<CommentReply>> {
    const requestId = randomId()
    try {
      const inputSubject = subject()
      const client = app.ready() ?? (await app.writable())
      await client.reply({ threadId: commentId, body, mentions, files, requestId, subject: inputSubject })
      const reply = list.value.flatMap((comment) => comment.replies).find((item) => item.requestId === requestId)
      if (!reply) throw new Error("The reply didn't stay in this browser. Try again.")
      return { value: reply }
    } catch (error) {
      return { error: notify.problem(error, "Couldn't keep the reply") }
    }
  }

  async function editMessage(
    commentId: string,
    messageId: string,
    body: string,
    mentions: string[] = [],
  ): Promise<Sent<CommentReply>> {
    if (waiting(commentId, messageId)) {
      if (!(await app.edit(messageId, body, mentions)))
        return { error: "It's on its way to the server. Edit it once it's there." }
      const comment = findComment(commentId)
      const edited = comment?.replies.find((reply) => reply.id === messageId) ?? comment
      return edited ? { value: { ...edited, id: messageId } } : { error: "This comment is gone." }
    }
    try {
      const edited = await $fetch<CommentReply>(`/api/comments/${commentId}/messages/${messageId}`, {
        method: "PATCH",
        body: { body, mentions },
      })
      comments.data.value = comments.data.value.map((comment) => {
        if (comment.id !== commentId) return comment
        if (comment.messageId === messageId)
          return { ...comment, body: edited.body, mentions: edited.mentions, editedAt: edited.editedAt }
        return {
          ...comment,
          replies: comment.replies.map((reply) =>
            reply.id === messageId ? { ...edited, attachments: reply.attachments } : reply,
          ),
        }
      })
      void wrote.trigger()
      return { value: edited }
    } catch (error) {
      return { error: notify.problem(error, "Couldn't edit the message") }
    }
  }

  async function removeReply(commentId: string, replyId: string) {
    if (waiting(commentId, replyId)) return discard(replyId, "Couldn't delete the reply")
    try {
      await $fetch(`/api/comments/${commentId}/replies/${replyId}`, { method: "DELETE" })
      setReplies(commentId, (replies) => replies.filter((reply) => reply.id !== replyId))
      void wrote.trigger()
    } catch (error) {
      notify.fail("Couldn't delete the reply", error)
    }
  }

  const reloadVersion = () =>
    Promise.all([drop.refresh(), comments.refresh(), refreshNuxtData([keys.drops, keys.tree, keys.pinned, keys.usage])])

  async function acceptSuggestion(commentId: string) {
    try {
      const next = await $fetch<DropSummary>(`/api/comments/${commentId}/accept`, { method: "POST" })
      await reloadVersion()
      notify.say(`Published v${next.version}`, { action: { label: "Undo", onClick: () => void undo(commentId) } })
      return true
    } catch (error) {
      await Promise.allSettled([
        drop.refresh(),
        comments.refresh(),
        refreshNuxtData([keys.drops, keys.tree, keys.pinned, keys.usage]),
      ])
      notify.fail("Couldn't accept the suggestion", error)
      return false
    }
  }
  async function undo(commentId: string) {
    try {
      const next = await $fetch<DropSummary>(`/api/comments/${commentId}/accept`, { method: "DELETE" })
      await reloadVersion()
      notify.done(`Published v${next.version} without it`)
    } catch (error) {
      await Promise.allSettled([
        drop.refresh(),
        comments.refresh(),
        refreshNuxtData([keys.drops, keys.tree, keys.pinned, keys.usage]),
      ])
      notify.fail("Couldn't undo the suggestion", error)
    }
  }

  return {
    drop,
    comments,
    commentRead,
    preferPrimaryComments,
    list,
    outboxEntries: app.entries,
    onWrote: wrote.on,
    findComment,
    addComment,
    addSiteComment,
    resolveComment,
    removeComment,
    addReply,
    editMessage,
    removeReply,
    acceptSuggestion,
  }
}

export const [provideDrop, injectDrop] = createInjectionState(useDrop)

export function useVersionTo() {
  const route = useRoute()
  const state = injectDrop()!
  return (version: Pick<DropVersion, "version">) =>
    route.path.startsWith("/d/") && state.drop.data.value
      ? dropPath(state.drop.data.value, version.version)
      : `/drops/${state.drop.data.value?.id}?v=${version.version}`
}

export const waitingForReview = (error: unknown) =>
  errorData(error, v.object({ shareReview: v.literal("pending") })) !== undefined

export function useHerePath() {
  const route = useRoute()
  const router = useRouter()
  return computed(() => router.resolve({ path: route.path, query: route.query }).fullPath)
}
