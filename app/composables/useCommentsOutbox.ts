import {
  createCommentsClient,
  createIndexedDBOutboxStore,
  type CommentsClient,
  type CommentsOutbox,
  type CommentsOutboxEntry,
  type CommentsOutboxEnvironment,
  type CommentsOutboxStore,
  type CommentUser,
} from "vite-hub/comments/client"
import type { CommentReply, DropComment } from "#shared/types"
import * as v from "valibot"
import { dropOf, dropTransport, GUEST_ACCOUNT, statusOf } from "../utils/comment-outbox"

/** A drop page that shows its comments as they land. A drop without one only loads its list again. */
export interface OutboxPage {
  drop: () => string
  /** The server took a comment: `comment` when the route answered it, else the page loads its list again. */
  created: (requestId: string, comment: DropComment | null) => void | Promise<void>
  replied: (requestId: string, threadId: string, reply: CommentReply) => void
  /** Another tab sent one of this drop's comments: the page loads its list again, which now has it. */
  refresh: () => Promise<unknown>
}

type Client = CommentsClient & { readonly outbox: CommentsOutbox }

export interface AppCommentsOutbox {
  /** Whose entries the outbox holds: the signed-in person's, the last one's while theirs wait, or GUEST_ACCOUNT. */
  account: Readonly<Ref<string>>
  /** Who the waiting comments show as: the account's person, or none for a guest. */
  author: Readonly<Ref<CommentUser | undefined>>
  /** Every saved comment and reply of the account that hasn't gone out, waiting or refused. */
  entries: Readonly<Ref<readonly CommentsOutboxEntry[]>>
  /** The comments and replies the server took in this tab, by `requestId`, with the thread each is in. */
  accepted: ReadonlyMap<string, string>
  /** The client that saves new comments and replies, once the browser started it. */
  client: () => Client | undefined
  outbox: () => CommentsOutbox | undefined
  /** Shows the page's drop's comments as they land, until the page's scope ends. */
  attach: (page: OutboxPage) => void
  /** Discards every entry of the account and forgets whose they were, as at sign-out. */
  clear: () => Promise<void>
}

/** Whose entries this browser's outbox holds, and whether they go out (`held`: not while that person is signed out). */
interface Holder {
  account: string
  user?: CommentUser
  held: boolean
}

/**
 * Who wrote the waiting comments while signed in, kept so they still show as that person's after a sign-out or an
 * expired session, until they go out or are discarded. Each read and write may throw where storage is blocked.
 */
const AUTHOR_KEY = "drop-comments-author"
const AuthorSchema = v.object({ id: v.string(), name: v.string(), image: v.optional(v.string()) })
const author = {
  read() {
    try {
      const parsed = v.safeParse(AuthorSchema, JSON.parse(localStorage.getItem(AUTHOR_KEY) ?? "null"))
      return parsed.success ? parsed.output : undefined
    } catch {
      return undefined
    }
  },
  write(user: CommentUser) {
    try {
      localStorage.setItem(
        AUTHOR_KEY,
        JSON.stringify({ id: user.id, name: user.name ?? "", ...(user.image ? { image: user.image } : {}) }),
      )
    } catch {
      // Blocked storage: the comments still go out, they just show as a guest's after a sign-out.
    }
  },
  forget() {
    try {
      localStorage.removeItem(AUTHOR_KEY)
    } catch {
      // Blocked storage held nothing.
    }
  },
}

/** Moves what a guest wrote in this browser to the person who signed in here, so it goes out as them. */
async function adoptGuests(store: CommentsOutboxStore, account: string) {
  const guests = await store.list(GUEST_ACCOUNT)
  if (!guests.length) return
  await store.update(account, (entries) => {
    for (const entry of guests) if (!entries.has(entry.id)) entries.set(entry.id, { ...entry, account })
  })
  await store.update(GUEST_ACCOUNT, (entries) => {
    for (const entry of guests) entries.delete(entry.id)
  })
}

/**
 * The app's one comments outbox: what the reader wrote keeps going out after they leave the drop page, every page can
 * count what still waits, and the tab-close guard and sign-out read it. It sends the signed-in person's entries, or the
 * guests' ones (GUEST_ACCOUNT). What a guest wrote goes out as whoever signs in next in this browser. Signed out, the
 * last person's entries stay in view, held ("Sign in to send"), until they sign in again or discard them.
 */
export function createCommentsOutbox(
  options: { store?: CommentsOutboxStore; environment?: CommentsOutboxEnvironment } = {},
): AppCommentsOutbox {
  const client = shallowRef<Client>()
  const holder = shallowRef<Holder>()
  const entries = shallowRef<readonly CommentsOutboxEntry[]>([])
  const pages = new Set<OutboxPage>()
  const accepted = new Map<string, string>()
  // What this tab sent, including site reviews, whose route answers no comment.
  const sentHere = new Set<string>()
  const outbox: AppCommentsOutbox = {
    account: computed(() => holder.value?.account ?? GUEST_ACCOUNT),
    author: computed(() => holder.value?.user),
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
      if (import.meta.client) author.forget()
    },
  }
  // The outbox lives in the browser: the server renders the comments it has.
  if (import.meta.server) return outbox

  const notify = useNotify()
  const { data: me, status } = useMe()
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
  let resolving = 0
  watch(
    [() => me.value?.id, known],
    async ([id, ready]) => {
      if (!ready) return
      const turn = ++resolving
      const person = me.value
      let next: Holder
      if (id && person) {
        // The guests' client stops before their entries move, so it can't send one on the way.
        if (holder.value?.account === GUEST_ACCOUNT) holder.value = undefined
        await adoptGuests(store, id).catch((error: unknown) => reportClientError("comments-adopt", error))
        next = {
          account: id,
          user: { id, name: person.name, ...(person.image ? { image: person.image } : {}) },
          held: false,
        }
      } else {
        const last = author.read()
        const waiting = last ? await store.list(last.id).catch(() => []) : []
        if (last && waiting.length) next = { account: last.id, user: last, held: true }
        else {
          if (last) author.forget()
          next = { account: GUEST_ACCOUNT, held: false }
        }
      }
      if (turn === resolving) holder.value = next
    },
    { immediate: true },
  )

  /** A held account with nothing left: whose they were is forgotten, and the guests' outbox takes over. */
  async function releaseIfEmpty(who: Holder) {
    const left = await store.list(who.account).catch(() => [])
    if (left.length || holder.value !== who) return
    author.forget()
    holder.value = { account: GUEST_ACCOUNT, held: false }
  }

  watch(
    holder,
    (who, _, onCleanup) => {
      if (!who) return
      const transport = dropTransport({
        fetch: $fetch,
        held: who.held,
        ...(who.account === GUEST_ACCOUNT ? {} : { as: who.account }),
        async created(requestId, drop, comment) {
          sentHere.add(requestId)
          if (comment) accepted.set(requestId, comment.id)
          const page = pageOf(drop)
          if (page) await page.created(requestId, comment)
          else await refreshNuxtData(keys.comments(drop))
        },
        replied(requestId, drop, threadId, reply) {
          sentHere.add(requestId)
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
        ...(who.user ? { user: who.user } : {}),
        refreshOnFocus: false,
        outbox: { account: who.account, store, ...(options.environment ? { environment: options.environment } : {}) },
      })
      client.value = next
      entries.value = next.outbox.entries
      let before = next.outbox.entries
      const stopChange = next.onChange(() => {
        const now = next.outbox.entries
        entries.value = now
        // One that left without this tab sending it went out from another tab: the drop's list loads it.
        const left = before.filter(
          (entry) => !sentHere.has(entry.requestId) && !now.some((item) => item.id === entry.id),
        )
        const emptied = before.length > 0 && !now.length
        before = now
        for (const drop of new Set(left.map(dropOf))) {
          if (!drop) continue
          const page = pageOf(drop)
          void (page ? page.refresh() : refreshNuxtData(keys.comments(drop)))
        }
        // Whose they are outlives a sign-out while any wait, and goes with the last of them.
        if (now.length && who.user && !who.held) author.write(who.user)
        else if (emptied && who.account !== GUEST_ACCOUNT) author.forget()
        if (emptied && who.held) holder.value = { account: GUEST_ACCOUNT, held: false }
      })
      const stop = next.start()
      // What a 401 held for this person goes out now that they're signed in again. Signed out, it stays held, unless
      // the last of it went out or was discarded while this outbox started.
      if (!who.held) void next.outbox.retry()
      else void releaseIfEmpty(who)
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
  useEventListener(window, "beforeunload", guard)

  return outbox
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
