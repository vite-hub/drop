import type { DropComment, DropDetail, DropSummary } from "#shared/types"
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
      notify.done(`Comment ${comment.n} added`)
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

  /** New text for a doc, or a new file set for an app. Docs become a new drop id; apps keep theirs. */
  async function publish(body: { content: string } | { files: Record<string, string> }) {
    try {
      const next = await $fetch<DropSummary>(`/api/drops/${toValue(id)}/versions`, { method: "POST", body })
      await refreshNuxtData("drops")
      if ("files" in body) await drop.refresh()
      return next
    }
    catch (error) {
      notify.fail("Couldn't publish", error)
    }
  }

  return { drop, comments, addComment, resolveComment, removeComment, publish }
}

/** The drop page provides its drop; the viewer and its panels inject it instead of threading props. */
export const [provideDrop, injectDrop] = createInjectionState(useDrop)
