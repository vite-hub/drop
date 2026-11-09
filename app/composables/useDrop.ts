import { dropPath } from "#shared/links"
import type { CommentReply, DropComment, DropDetail, DropSummary, DropVersion } from "#shared/types"
import type { CommentInput } from "#shared/schemas"
import * as v from "valibot"

/** What a comment box waits on: what it posted, or the sentence to show under it (none when the plan-limit dialog says it). */
export type Sent<T> = { value: T } | { error?: string }

/** A comment's or reply's body: JSON, or multipart with the JSON in `data` when it carries images. */
function withImages(data: Partial<CommentInput> & { body: string; mentions: string[] }, files: File[]) {
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

  // Each comment this reader writes, once it went through: the presence room tells the others to load them now
  // (usePresence's `commented`). Loading them again never fires it, so two viewers can't keep waking each other.
  const wrote = createEventHook<void>()

  // No toast either way: the new pin shows it went through, and a failure shows under the box that sent it.
  async function addComment(
    input: Omit<CommentInput, "body" | "mentions">,
    body: string,
    files: File[] = [],
    mentions: string[] = [],
  ): Promise<Sent<DropComment>> {
    try {
      const comment = await $fetch<DropComment>(`/api/drops/${toValue(id)}/comments`, {
        method: "POST",
        query: query.value,
        body: withImages({ ...input, body, mentions }, files),
      })
      comments.data.value = [...comments.data.value, comment]
      void wrote.trigger()
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
      void wrote.trigger()
    } catch (error) {
      comments.data.value = before
      notify.fail("Couldn't update the comment", error)
    }
  }

  async function removeComment(commentId: string) {
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
    try {
      const reply = await $fetch<CommentReply>(`/api/comments/${commentId}/replies`, {
        method: "POST",
        body: withImages({ body, mentions }, files),
      })
      setReplies(commentId, (replies) => [...replies, reply])
      void wrote.trigger()
      return { value: reply }
    } catch (error) {
      return { error: notify.problem(error) }
    }
  }

  /** New words for one's own comment (its `messageId`) or reply. */
  async function editMessage(commentId: string, messageId: string, body: string, mentions: string[] = []) {
    try {
      const edited = await $fetch<CommentReply>(`/api/messages/${messageId}`, {
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
      return { value: edited } satisfies Sent<CommentReply>
    } catch (error) {
      return { error: notify.problem(error) } satisfies Sent<CommentReply>
    }
  }

  async function removeReply(commentId: string, replyId: string) {
    try {
      await $fetch(`/api/replies/${replyId}`, { method: "DELETE" })
      setReplies(commentId, (replies) => replies.filter((reply) => reply.id !== replyId))
      void wrote.trigger()
    } catch (error) {
      notify.fail("Couldn't delete the reply", error)
    }
  }

  // A new version adds bytes and a write, so the lists and the plan usage move too.
  const reloadVersion = () =>
    Promise.all([drop.refresh(), comments.refresh(), refreshNuxtData([keys.drops, keys.tree, keys.usage])])

  /**
   * Puts a suggestion's words into the doc as its next version and resolves it. The drop keeps its id, so the page
   * reloads its data and shows the new version. Resolves to whether it went through; a failure says why in a toast.
   */
  async function acceptSuggestion(commentId: string) {
    try {
      const next = await $fetch<DropSummary>(`/api/comments/${commentId}/accept`, { method: "POST" })
      await reloadVersion()
      notify.say(`Published v${next.version}`, { action: { label: "Undo", onClick: () => void undo(commentId) } })
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
  /** Takes an accepted suggestion back: the text from before is published again, and the suggestion opens again. */
  async function undo(commentId: string) {
    try {
      const next = await $fetch<DropSummary>(`/api/comments/${commentId}/accept`, { method: "DELETE" })
      await reloadVersion()
      notify.done(`Published v${next.version} without it`)
    } catch (error) {
      await Promise.allSettled([
        drop.refresh(),
        comments.refresh(),
        refreshNuxtData([keys.drops, keys.tree, keys.usage]),
      ])
      notify.fail("Couldn't undo the suggestion", error)
    }
  }

  return {
    drop,
    comments,
    /** Runs after each comment write of this reader's, for whoever else should hear of it. */
    onWrote: wrote.on,
    /** For a comment written outside these actions, such as a site review's screenshot comment. */
    wrote: () => void wrote.trigger(),
    findComment,
    addComment,
    resolveComment,
    removeComment,
    addReply,
    editMessage,
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
