import { dropPath } from "#shared/links"
import type { CommentReply, DropComment, DropDetail, DropVersion } from "#shared/types"
import type { CommentInput } from "#shared/schemas"
import * as v from "valibot"

/** What a comment box waits on: what it posted, or the sentence to show under it (none when the plan-limit dialog says it). */
export type Sent<T> = { value: T } | { error?: string }

/**
 * Comments and replies show the moment they're sent, under an id of this shape, and take the server's once it answers.
 * Until then they can't be resolved, deleted, or replied to.
 */
const PENDING = "pending:"
export const isPending = (id: string) => id.startsWith(PENDING)

/**
 * One drop and its comments, with the actions the viewer needs. Keys follow the id, so the cache
 * stays right when the router reuses the page for another drop (the next version, for instance).
 */
function useDrop(id: MaybeRefOrGetter<string>) {
  const notify = useNotify()
  const drop = useApi<DropDetail>(() => `/api/drops/${toValue(id)}`, { key: () => keys.drop(toValue(id)) })
  const comments = useApi<DropComment[]>(() => `/api/drops/${toValue(id)}/comments`, {
    key: () => keys.comments(toValue(id)),
    default: () => [],
  })
  const { data: me } = useMe()
  const author = () => ({ authorName: me.value?.name ?? "Guest", authorImage: me.value?.image ?? null, mine: true })
  /** The server's id for a comment that was pending, so a thread opened on its pin stays open once it lands. */
  const landed = new Map<string, string>()

  // Optimistic, with no toast either way: the pin shows at once, and a failure takes it away and shows under the box
  // that sent it (DropViewer reopens that box with the text).
  async function addComment(input: Omit<CommentInput, "body">, body: string): Promise<Sent<DropComment>> {
    const pendingId = PENDING + crypto.randomUUID()
    const list = comments.data.value
    comments.data.value = [
      ...list,
      {
        ...input,
        id: pendingId,
        // A guess the server's number replaces, unless someone else commented meanwhile.
        n: Math.max(0, ...list.map((comment) => comment.n)) + 1,
        quote: input.quote ?? null,
        label: input.label ?? null,
        page: input.page ?? null,
        body: body.trim(),
        ...author(),
        resolved: false,
        createdAt: Date.now(),
        version: drop.data.value?.version ?? 0,
        replies: [],
      },
    ]
    try {
      const comment = await $fetch<DropComment>(`/api/drops/${toValue(id)}/comments`, {
        method: "POST",
        body: { ...input, body },
      })
      landed.set(pendingId, comment.id)
      comments.data.value = comments.data.value.map((item) => (item.id === pendingId ? comment : item))
      return { value: comment }
    } catch (error) {
      comments.data.value = comments.data.value.filter((item) => item.id !== pendingId)
      return { error: notify.problem(error) }
    }
  }
  /** A comment by its id, also the id it had while it was pending. */
  const findComment = (commentId: string) => {
    const real = landed.get(commentId) ?? commentId
    return comments.data.value.find((comment) => comment.id === real)
  }

  // Optimistic: the checkbox flips at once and rolls back if the server says no.
  async function resolveComment(commentId: string, resolved: boolean) {
    if (isPending(commentId)) return
    const before = comments.data.value
    comments.data.value = before.map((comment) => (comment.id === commentId ? { ...comment, resolved } : comment))
    try {
      await $fetch(`/api/comments/${commentId}`, { method: "PATCH", body: { resolved } })
    } catch (error) {
      comments.data.value = before
      notify.fail("Couldn't update the comment", error)
    }
  }

  async function removeComment(commentId: string) {
    if (isPending(commentId)) return
    try {
      await $fetch(`/api/comments/${commentId}`, { method: "DELETE" })
      comments.data.value = comments.data.value.filter((comment) => comment.id !== commentId)
    } catch (error) {
      notify.fail("Couldn't delete the comment", error)
    }
  }

  const setReplies = (commentId: string, change: (replies: CommentReply[]) => CommentReply[]) =>
    (comments.data.value = comments.data.value.map((comment) =>
      comment.id === commentId ? { ...comment, replies: change(comment.replies) } : comment,
    ))

  // Optimistic like comments: the reply shows under the thread at once and leaves again if the server refuses it.
  async function addReply(commentId: string, body: string): Promise<Sent<CommentReply>> {
    if (isPending(commentId)) return { error: "The comment is still being posted." }
    const pendingId = PENDING + crypto.randomUUID()
    setReplies(commentId, (replies) => [
      ...replies,
      { id: pendingId, body: body.trim(), createdAt: Date.now(), ...author() },
    ])
    try {
      const reply = await $fetch<CommentReply>(`/api/comments/${commentId}/replies`, { method: "POST", body: { body } })
      setReplies(commentId, (replies) => replies.map((item) => (item.id === pendingId ? reply : item)))
      return { value: reply }
    } catch (error) {
      setReplies(commentId, (replies) => replies.filter((item) => item.id !== pendingId))
      return { error: notify.problem(error) }
    }
  }

  async function removeReply(commentId: string, replyId: string) {
    if (isPending(replyId)) return
    try {
      await $fetch(`/api/replies/${replyId}`, { method: "DELETE" })
      setReplies(commentId, (replies) => replies.filter((reply) => reply.id !== replyId))
    } catch (error) {
      notify.fail("Couldn't delete the reply", error)
    }
  }

  return { drop, comments, findComment, addComment, resolveComment, removeComment, addReply, removeReply }
}

/** The drop page provides its drop; the viewer and its panels inject it instead of threading props. */
export const [provideDrop, injectDrop] = createInjectionState(useDrop)

/** Where a version of the viewed drop opens: its pinned link on a shared page (no sign-in), its page in the app otherwise. */
export function useVersionTo() {
  const route = useRoute()
  const state = injectDrop()!
  return (version: Pick<DropVersion, "id" | "version">) =>
    route.path.startsWith("/d/") && state.drop.data.value
      ? dropPath(state.drop.data.value, version.version)
      : `/drops/${version.id}`
}

/** The drop API refused because the drop's share waits for the operator's review (server/api/drops/[id].get.ts). */
export const waitingForReview = (error: unknown) =>
  errorData(error, v.object({ shareReview: v.literal("pending") })) !== undefined

/** Where the visitor is, for the sign-in redirect and the retry link: the path and query, not the hash SSR never sees. */
export function useHerePath() {
  const route = useRoute()
  const router = useRouter()
  return computed(() => router.resolve({ path: route.path, query: route.query }).fullPath)
}
