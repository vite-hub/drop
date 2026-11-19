import {
  createCommentsClient,
  createIndexedDBOutboxStore,
  type CommentsClient,
  type CommentsOutbox,
  type CommentsOutboxEntry,
  type CommentsOutboxEnvironment,
  type CommentsOutboxStore,
} from "vite-hub/comments/client"
import type { CommentReply, DropComment } from "#shared/types"
import { dropTransport, GUEST_ACCOUNT, outboxAccount, statusOf } from "../utils/comment-outbox"

/** A drop page that shows its comments as they land. A drop without one only loads its list again. */
export interface OutboxPage {
  drop: () => string
  /** The server took a comment: `comment` when the route answered it, else the page loads its list again. */
  created: (requestId: string, comment: DropComment | null) => void | Promise<void>
  replied: (requestId: string, threadId: string, reply: CommentReply) => void
}

type Client = CommentsClient & { readonly outbox: CommentsOutbox }

export interface AppCommentsOutbox {
  /** The signed-in person's id, or GUEST_ACCOUNT. */
  account: Readonly<Ref<string>>
  /** Every saved comment and reply of the account that hasn't gone out, waiting or refused. */
  entries: Readonly<Ref<readonly CommentsOutboxEntry[]>>
  /** The comments and replies the server took in this tab, by `requestId`, with the thread each is in. */
  accepted: ReadonlyMap<string, string>
  /** The client that saves new comments and replies, once the browser started it. */
  client: () => Client | undefined
  outbox: () => CommentsOutbox | undefined
  /** Shows the page's drop's comments as they land, until the page's scope ends. */
  attach: (page: OutboxPage) => void
  /** Discards every entry of the account, as at sign-out. */
  clear: () => Promise<void>
}

/**
 * The app's one comments outbox: what the reader wrote keeps going out after they leave the drop page, every page can
 * count what still waits, and the tab-close guard and sign-out read it. It sends the signed-in person's entries, or the
 * guests' ones (GUEST_ACCOUNT); another account's stay saved and go out once that person is signed in again.
 */
export function createCommentsOutbox(
  options: { store?: CommentsOutboxStore; environment?: CommentsOutboxEnvironment } = {},
): AppCommentsOutbox {
  const client = shallowRef<Client>()
  const entries = shallowRef<readonly CommentsOutboxEntry[]>([])
  const pages = new Set<OutboxPage>()
  const accepted = new Map<string, string>()
  const outbox: AppCommentsOutbox = {
    account: computed(() => GUEST_ACCOUNT),
    entries,
    accepted,
    client: () => client.value,
    outbox: () => client.value?.outbox,
    attach(page) {
      pages.add(page)
      onScopeDispose(() => pages.delete(page))
    },
    clear: async () => {
      await client.value?.outbox.clear()
    },
  }
  // The outbox lives in the browser: the server renders the comments it has.
  if (import.meta.server) return outbox

  const notify = useNotify()
  const { data: me, status } = useMe()
  const account = computed(() => outboxAccount(me.value?.id))
  // One store for every account, so a person's entries are still there when they sign in again in this page.
  const store = options.store ?? createIndexedDBOutboxStore()
  const pageOf = (drop: string | undefined) => [...pages].find((page) => page.drop() === drop)

  // Who's signed in is known once /api/me first answers; until then nothing goes out as a guest by mistake.
  const known = ref(false)
  watch(
    status,
    (value) => {
      if (value === "success" || value === "error") known.value = true
    },
    { immediate: true },
  )
  watch(
    [account, known],
    ([who, ready], _, onCleanup) => {
      if (!ready) return
      const user = me.value
        ? { id: me.value.id, name: me.value.name, ...(me.value.image ? { image: me.value.image } : {}) }
        : undefined
      const transport = dropTransport({
        fetch: $fetch,
        ...(who === GUEST_ACCOUNT ? {} : { as: who }),
        async created(requestId, drop, comment) {
          if (comment) accepted.set(requestId, comment.id)
          const page = pageOf(drop)
          if (page) await page.created(requestId, comment)
          else await refreshNuxtData(keys.comments(drop))
        },
        replied(requestId, drop, threadId, reply) {
          accepted.set(requestId, threadId)
          const page = pageOf(drop)
          if (page) page.replied(requestId, threadId, reply)
          else if (drop) void refreshNuxtData(keys.comments(drop))
        },
        refused(error) {
          // Only the plan-limit dialog speaks now; the comment itself says it waits or was refused.
          if (quotaFailureOf(error)) notify.problem(error)
          // The session isn't the person who wrote it: learn who's signed in now. The entry waits until they sign in again.
          if (statusOf(error) === 401) void refreshNuxtData(keys.me)
        },
      })
      const next = createCommentsClient({
        transport,
        user,
        refreshOnFocus: false,
        outbox: { account: who, store, ...(options.environment ? { environment: options.environment } : {}) },
      })
      client.value = next
      entries.value = next.outbox.entries
      const stopChange = next.onChange(() => (entries.value = next.outbox.entries))
      const stop = next.start()
      // What a 401 held for this person goes out now that they're signed in again.
      void next.outbox.retry()
      onCleanup(() => {
        stopChange()
        stop()
        if (client.value === next) client.value = undefined
      })
    },
    { immediate: true },
  )

  // Closing the tab asks first while anything waits or was refused, on any page of the app.
  const guard = (event: Event) => {
    if (entries.value.length) event.preventDefault()
  }
  window.addEventListener("beforeunload", guard)
  onScopeDispose(() => window.removeEventListener("beforeunload", guard))

  return { ...outbox, account }
}

const outboxes = new WeakMap<object, AppCommentsOutbox>()

/** The app's comments outbox (createCommentsOutbox), started by the comments-outbox plugin and kept for the app's life. */
export function useCommentsOutbox() {
  const nuxtApp = useNuxtApp()
  const known = outboxes.get(nuxtApp)
  if (known) return known
  // Detached, so no page's scope stops it. The plugin calls this first, in the app's context.
  const outbox = effectScope(true).run(() => createCommentsOutbox())
  if (!outbox) throw new Error("The comments outbox didn't start.")
  outboxes.set(nuxtApp, outbox)
  return outbox
}
