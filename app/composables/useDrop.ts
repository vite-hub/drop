import { dropPath } from "#shared/links"
import type { CommentReply, DropComment, DropDetail, DropSummary, DropVersion } from "#shared/types"
import type { CommentInput } from "#shared/schemas"
import * as v from "valibot"

/** What a comment box waits on: what it posted, or the sentence to show under it (none when the plan-limit dialog says it). */
export type Sent<T> = { value: T } | { error?: string }

/** A comment's or reply's body: JSON, or multipart with the JSON in `data` when it carries images. */
function withImages(data: Partial<CommentInput>, files: File[]) {
  if (!files.length) return data
  const form = new FormData()
  form.append("data", JSON.stringify(data))
  for (const file of files) form.append("image", file, file.name || "image")
  return form
}

/**
 * One drop and its comments, with the actions the viewer needs: its latest version, or the earlier one `version`
 * names. Keys follow both, so the cache stays right when the router reuses the page for another drop or version.
 */
function useDrop(id: MaybeRefOrGetter<string>, version?: MaybeRefOrGetter<number | undefined>) {
  const notify = useNotify()
  const query = computed(() => (toValue(version) ? { v: toValue(version) } : {}))
  const drop = useApi<DropDetail>(() => `/api/drops/${toValue(id)}`, {
    key: () => keys.drop(toValue(id), toValue(version)),
    query,
  })
  const comments = useApi<DropComment[]>(() => `/api/drops/${toValue(id)}/comments`, {
    key: () => keys.comments(toValue(id), toValue(version)),
    query,
    default: () => [],
  })

  // No toast either way: the new pin shows it went through, and a failure shows under the box that sent it.
  async function addComment(
    input: Omit<CommentInput, "body">,
    body: string,
    files: File[] = [],
  ): Promise<Sent<DropComment>> {
    try {
      const comment = await $fetch<DropComment>(`/api/drops/${toValue(id)}/comments`, {
        method: "POST",
        query: query.value,
        body: withImages({ ...input, body }, files),
      })
      comments.data.value = [...comments.data.value, comment]
      return { value: comment }
    } catch (error) {
      return { error: notify.problem(error) }
    }
  }

  const findComment = (commentId: string) => comments.data.value.find((comment) => comment.id === commentId)

  // Optimistic: the checkbox flips at once and rolls back if the server says no.
  async function resolveComment(commentId: string, resolved: boolean) {
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

  async function addReply(commentId: string, body: string, files: File[] = []): Promise<Sent<CommentReply>> {
    try {
      const reply = await $fetch<CommentReply>(`/api/comments/${commentId}/replies`, {
        method: "POST",
        body: withImages({ body }, files),
      })
      setReplies(commentId, (replies) => [...replies, reply])
      return { value: reply }
    } catch (error) {
      return { error: notify.problem(error) }
    }
  }

  async function removeReply(commentId: string, replyId: string) {
    try {
      await $fetch(`/api/replies/${replyId}`, { method: "DELETE" })
      setReplies(commentId, (replies) => replies.filter((reply) => reply.id !== replyId))
    } catch (error) {
      notify.fail("Couldn't delete the reply", error)
    }
  }

  /**
   * Puts a suggestion's words into the doc as its next version and resolves it. The drop keeps its id, so the page
   * reloads its data and shows the new version. Resolves to whether it went through; a failure says why in a toast.
   */
  async function acceptSuggestion(commentId: string) {
    try {
      const next = await $fetch<DropSummary>(`/api/comments/${commentId}/accept`, { method: "POST" })
      // A new version adds bytes and a write, so the lists and the plan usage move too.
      await Promise.all([drop.refresh(), comments.refresh(), refreshNuxtData([keys.drops, keys.tree, keys.usage])])
      notify.done(`Published v${next.version}`)
      return true
    } catch (error) {
      // The version may already be published while its comment still needs resolution on retry.
      await Promise.allSettled([
        drop.refresh(),
        comments.refresh(),
        refreshNuxtData([keys.drops, keys.tree, keys.usage]),
      ])
      notify.fail("Couldn't accept the suggestion", error)
      return false
    }
  }

  return {
    drop,
    comments,
    findComment,
    addComment,
    resolveComment,
    removeComment,
    addReply,
    removeReply,
    acceptSuggestion,
  }
}

/** The drop page provides its drop; the viewer and its panels inject it instead of threading props. */
export const [provideDrop, injectDrop] = createInjectionState(useDrop)

/** Where a version of the viewed drop opens: its pinned link on a shared page (no sign-in), its page in the app otherwise. */
export function useVersionTo() {
  const route = useRoute()
  const state = injectDrop()!
  return (version: Pick<DropVersion, "version">) =>
    route.path.startsWith("/d/") && state.drop.data.value
      ? dropPath(state.drop.data.value, version.version)
      : `/drops/${state.drop.data.value?.id}?v=${version.version}`
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
