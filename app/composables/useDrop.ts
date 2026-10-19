import { dropPath } from "#shared/links"
import type { CommentReply, DropComment, DropDetail, DropVersion } from "#shared/types"
import type { CommentInput } from "#shared/schemas"

/**
 * One drop and its comments, with the actions the viewer needs. Keys follow the id, so the cache
 * stays right when the router reuses the page for another drop (the next version, for instance).
 */
export function useDrop(id: MaybeRefOrGetter<string>) {
  const notify = useNotify()
  const dropKey = () => `drop:${toValue(id)}`
  const commentsKey = () => `comments:${toValue(id)}`
  const drop = useApi<DropDetail>(() => `/api/drops/${toValue(id)}`, { key: dropKey })
  const comments = useApi<DropComment[]>(() => `/api/drops/${toValue(id)}/comments`, { key: commentsKey, default: () => [] })

  async function addComment(input: Omit<CommentInput, "body">, body: string) {
    try {
      const comment = await $fetch<DropComment>(`/api/drops/${toValue(id)}/comments`, { method: "POST", body: { ...input, body } })
      comments.data.value = [...comments.data.value, comment]
      notify.done("Comment added")
      return comment
    }
    catch (error) {
      notify.fail("Couldn't add the comment", error)
    }
  }

  // Optimistic: the checkbox flips at once and rolls back if the server says no.
  async function resolveComment(commentId: string, resolved: boolean) {
    const before = comments.data.value
    comments.data.value = before.map(comment => (comment.id === commentId ? { ...comment, resolved } : comment))
    try {
      await $fetch(`/api/comments/${commentId}`, { method: "PATCH", body: { resolved } })
    }
    catch (error) {
      comments.data.value = before
      notify.fail("Couldn't update the comment", error)
    }
  }

  async function removeComment(commentId: string) {
    try {
      await $fetch(`/api/comments/${commentId}`, { method: "DELETE" })
      comments.data.value = comments.data.value.filter(comment => comment.id !== commentId)
    }
    catch (error) {
      notify.fail("Couldn't delete the comment", error)
    }
  }

  const setReplies = (commentId: string, change: (replies: CommentReply[]) => CommentReply[]) =>
    (comments.data.value = comments.data.value.map(comment => (comment.id === commentId ? { ...comment, replies: change(comment.replies) } : comment)))

  async function addReply(commentId: string, body: string) {
    try {
      const reply = await $fetch<CommentReply>(`/api/comments/${commentId}/replies`, { method: "POST", body: { body } })
      setReplies(commentId, replies => [...replies, reply])
      return reply
    }
    catch (error) {
      notify.fail("Couldn't send the reply", error)
    }
  }

  async function removeReply(commentId: string, replyId: string) {
    try {
      await $fetch(`/api/replies/${replyId}`, { method: "DELETE" })
      setReplies(commentId, replies => replies.filter(reply => reply.id !== replyId))
    }
    catch (error) {
      notify.fail("Couldn't delete the reply", error)
    }
  }

  return { drop, comments, addComment, resolveComment, removeComment, addReply, removeReply }
}

/** The drop page provides its drop; the viewer and its panels inject it instead of threading props. */
export const [provideDrop, injectDrop] = createInjectionState(useDrop)

/** Where a version of the viewed drop opens: its pinned link on a shared page (no sign-in), its page in the app otherwise. */
export function useVersionTo() {
  const route = useRoute()
  const state = injectDrop()!
  return (version: Pick<DropVersion, "id" | "version">) =>
    route.path.startsWith("/d/") && state.drop.data.value ? dropPath(state.drop.data.value, version.version) : `/drops/${version.id}`
}
