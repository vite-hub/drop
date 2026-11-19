import { dropPath } from "#shared/links"
import type { CommentReply, DropComment, DropDetail, DropSummary, DropVersion } from "#shared/types"
import * as v from "valibot"
import { replyMessageId } from "vite-hub/comments/client"
import {
  type CommentPlace,
  randomId,
  replyKey,
  type SiteCommentPlace,
  targetMetadata,
  waitingReplies,
  withOutbox,
} from "../utils/comment-outbox"

/** What a comment box waits on: what it posted, or the sentence to show under it (none when the plan-limit dialog says it). */
export type Sent<T> = { value: T } | { error?: string }

/**
 * One drop and its comments, with the actions the viewer needs: its latest version, or the earlier one `version`
 * names. Keys follow both, so the cache stays right when the router reuses the page for another drop or version.
 */
function useDrop(id: MaybeRefOrGetter<string>, version?: MaybeRefOrGetter<number | undefined>) {
  const notify = useNotify()
  const { data: me } = useMe()
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

  // Each comment this reader writes, once the server took it: the presence room tells the others to load them now
  // (usePresence's `commented`). Loading them again never fires it, so two viewers can't keep waking each other.
  const wrote = createEventHook<void>()

  // New comments and replies go through the app's outbox (useCommentsOutbox): saved in the browser with their images,
  // shown at once, and sent to Drop's routes once each, in order, as soon as the network lets them, on whatever page
  // the reader is by then. While this page is open, they land in its list.
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
  })
  const outbox = () => {
    const client = app.client()
    if (!client) throw new Error("Comments can't be written before the page has loaded.")
    return client
  }

  const view = () => ({
    drop: toValue(id),
    account: app.account.value,
    author: { name: me.value?.name ?? "Guest", image: me.value?.image ?? null },
    accepted: app.accepted,
  })
  // The id the server gives each waiting reply, so a list that already holds its copy (loaded before the reply's own
  // answer came back, or in another tab) shows it once. Worked out in the browser, which hashes asynchronously.
  const replyIds = shallowRef<ReadonlyMap<string, string>>(new Map())
  watch(
    () => waitingReplies(comments.data.value, app.entries.value, view()),
    async (replies) => {
      const missing = replies.filter(([thread, requestId]) => !replyIds.value.has(replyKey(thread, requestId)))
      if (!missing.length) return
      const found = await Promise.all(
        missing.map(async ([thread, requestId]) => {
          // crypto.subtle exists only on HTTPS and localhost: elsewhere the reply's requestId alone matches it.
          const message = await replyMessageId(thread, requestId).catch(() => undefined)
          return message ? [[replyKey(thread, requestId), message] as const] : []
        }),
      )
      if (found.flat().length) replyIds.value = new Map([...replyIds.value, ...found.flat()])
    },
    { immediate: true },
  )
  /** The drop's comments with the ones that wait to go out, each shown once. */
  const list = computed(() =>
    withOutbox(comments.data.value, app.entries.value, { ...view(), replyIds: replyIds.value }),
  )
  const findComment = (commentId: string) => list.value.find((comment) => comment.id === commentId)

  /**
   * Saves the comment and returns it at once, waiting to go out. No toast either way: the new pin shows it, and the
   * comment itself says when it waits or was refused. Fails only when the browser can't keep it.
   */
  async function addComment(
    input: CommentPlace,
    body: string,
    files: File[] = [],
    mentions: string[] = [],
  ): Promise<Sent<DropComment>> {
    const requestId = randomId()
    try {
      const at = toValue(version)
      const thread = await outbox().create({
        subject: subject(),
        anchor: { kind: "page" },
        body,
        mentions,
        files,
        requestId,
        metadata: targetMetadata({
          route: "comment",
          drop: toValue(id),
          ...(at ? { v: at } : {}),
          version: at ?? drop.data.value?.version ?? 0,
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

  /**
   * A comment drawn on a site in Drop's frame, with the screenshot of its box first among its images: it goes to the
   * site review's route (POST /api/drops/:id/review) through the same outbox.
   */
  async function addSiteComment(origin: string, place: SiteCommentPlace, body: string, files: Blob[]) {
    try {
      await outbox().create({
        subject: subject(),
        anchor: { kind: "page" },
        body,
        files,
        requestId: randomId(),
        metadata: targetMetadata({
          route: "review",
          drop: toValue(id),
          version: drop.data.value?.version ?? 0,
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

  /** Whether the message (a comment's own `messageId`, or a reply's id) still waits in the outbox. */
  const waiting = (commentId: string, messageId = commentId) => {
    const comment = findComment(commentId)
    if (!comment) return false
    if (comment.messageId === messageId) return Boolean(comment.delivery)
    return Boolean(comment.replies.find((reply) => reply.id === messageId)?.delivery)
  }
  /** Takes a waiting comment or reply out of the outbox, unless it's already on its way. */
  async function discard(messageId: string, title: string) {
    if (await outbox().outbox.dismiss(messageId)) return
    notify.alert(title, "It's on its way to the server. Delete it once it's there.")
  }

  // Optimistic: the checkbox flips at once and rolls back if the server says no.
  async function resolveComment(commentId: string, resolved: boolean) {
    // A waiting comment has nothing to resolve on the server yet.
    if (waiting(commentId)) return
    const before = comments.data.value
    // Resolving again marks the replies since the last time seen, so it counts from the newest one.
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

  /** Saves the reply and returns it at once, as addComment does. A reply to a waiting comment goes out after it. */
  async function addReply(
    commentId: string,
    body: string,
    files: File[] = [],
    mentions: string[] = [],
  ): Promise<Sent<CommentReply>> {
    const requestId = randomId()
    try {
      await outbox().reply({ threadId: commentId, body, mentions, files, requestId, subject: subject() })
      const reply = list.value.flatMap((comment) => comment.replies).find((item) => item.requestId === requestId)
      if (!reply) throw new Error("The reply didn't stay in this browser. Try again.")
      return { value: reply }
    } catch (error) {
      return { error: notify.problem(error, "Couldn't keep the reply") }
    }
  }

  /** New words for one's own comment (its `messageId`) or reply. */
  async function editMessage(
    commentId: string,
    messageId: string,
    body: string,
    mentions: string[] = [],
  ): Promise<Sent<CommentReply>> {
    // Waiting words change in the outbox and go out as edited.
    if (waiting(commentId, messageId)) {
      if (!(await outbox().outbox.edit(messageId, body, mentions)))
        return { error: "It's on its way to the server. Edit it once it's there." }
      const comment = findComment(commentId)
      const edited = comment?.replies.find((reply) => reply.id === messageId) ?? comment
      return edited ? { value: { ...edited, id: messageId } } : { error: "This comment is gone." }
    }
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
      return { value: edited }
    } catch (error) {
      return { error: notify.problem(error, "Couldn't edit the message") }
    }
  }

  async function removeReply(commentId: string, replyId: string) {
    if (waiting(commentId, replyId)) return discard(replyId, "Couldn't delete the reply")
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
    /** What the viewer shows: the server's comments and the ones that wait in the outbox, marked by `delivery`. */
    list,
    /** The saved comments and replies that haven't gone out, of every drop, for the dock. */
    outboxEntries: app.entries,
    /** The outbox's actions (retry, dismiss, edit, clear), once the browser started it. */
    outbox: app.outbox,
    /** Runs after each comment write of this reader's, for whoever else should hear of it. */
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
