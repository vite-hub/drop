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

/** A drop page that shows its comments as they land. A drop without one only loads its list again. */
interface OutboxPage {
  drop: () => string
  /** The server took a comment: `comment` when the route answered it, else the page loads its list again. */
  created: (requestId: string, comment: DropComment | null) => void | Promise<void>
  replied: (requestId: string, threadId: string, reply: CommentReply) => void
  /** Another tab sent one of this drop's comments: the page loads its list again, which now has it. */
  refresh: () => Promise<unknown>
}

type Client = CommentsClient & { readonly outbox: CommentsOutbox }

export interface AppCommentsOutbox {
  /** Whose new writes the active queue accepts. */
  account: Readonly<Ref<string>>
  author: (account: string) => CommentUser | undefined
  /** Saved entries of the active queue and any held queue visible while signed out. */
  entries: Readonly<Ref<readonly CommentsOutboxEntry[]>>
  /** The comments and replies the server took in this tab, by `requestId`, with the thread each is in. */
  accepted: ReadonlyMap<string, string>
  /** The client that saves new comments and replies, once the browser started it. */
  writable: () => Promise<Client>
  retry: (id: string) => Promise<void>
  /** Takes a waiting or refused comment or reply out, with the replies that wait on it. `false` while it's going out. */
  discard: (id: string) => Promise<boolean>
  /** Changes a waiting or refused one's words and sends it again. `false` while it's going out. */
  edit: (id: string, body: string, mentions?: string[]) => Promise<boolean>
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
function readAuthor() {
  try {
    const parsed = v.safeParse(AuthorSchema, JSON.parse(localStorage.getItem(AUTHOR_KEY) ?? "null"))
    return parsed.success ? parsed.output : undefined
  } catch {
    return undefined
  }
}
function writeAuthor(user: CommentUser) {
  try {
    localStorage.setItem(
      AUTHOR_KEY,
      JSON.stringify({ id: user.id, name: user.name ?? "", ...(user.image ? { image: user.image } : {}) }),
    )
  } catch {
    // Blocked storage: the comments still go out, they just show as a guest's after a sign-out.
  }
}
function forgetAuthor() {
  try {
    localStorage.removeItem(AUTHOR_KEY)
  } catch {
    // Blocked storage held nothing.
  }
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
  const active = shallowRef<Client>()
  const held = shallowRef<Client>()
  const holder = shallowRef<Holder>()
  const heldHolder = shallowRef<Holder>()
  const activeEntries = shallowRef<readonly CommentsOutboxEntry[]>([])
  const heldEntries = shallowRef<readonly CommentsOutboxEntry[]>([])
  const entries = computed(() => [...activeEntries.value, ...heldEntries.value])
  const queueFor = (id: string) =>
    activeEntries.value.some((entry) => entry.id === id) ? active.value?.outbox : held.value?.outbox
  const pages = new Set<OutboxPage>()
  const accepted = new Map<string, string>()
  // What this tab sent, including site reviews.
  const sentHere = new Set<string>()
  const outbox: AppCommentsOutbox = {
    account: computed(() => holder.value?.account ?? GUEST_ACCOUNT),
    author: (account) => [holder.value, heldHolder.value].find((who) => who?.account === account)?.user,
    entries,
    accepted,
    writable: async () => {
      throw new Error("Comments can't be written before the page has loaded.")
    },
    retry: async (id) => {
      if (activeEntries.value.some((entry) => entry.id === id)) await active.value?.outbox.retry(id)
    },
    discard: async () => false,
    edit: async () => false,
    attach(page) {
      pages.add(page)
      onScopeDispose(() => pages.delete(page))
    },
    clear: async () => {},
  }
  // The outbox lives in the browser: the server renders the comments it has.
  if (import.meta.server) return outbox

  const notify = useNotify()
  const { data: me, status } = useMe()
  // One store for every account, so a person's entries are still there when they sign in again in this page.
  const store = options.store ?? createIndexedDBOutboxStore()
  const pageOf = (drop: string | undefined) => [...pages].find((page) => page.drop() === drop)

  outbox.writable = async () => {
    const client = active.value
    const who = holder.value
    if (client && who) {
      await store.list(who.account)
      if (client === active.value && who.account === (me.value?.id ?? GUEST_ACCOUNT)) {
        if (!store.persisted)
          throw new Error("Allow browser storage before sending comments. Your draft is still here.")
        return client
      }
    }
    throw new Error("Comments aren't ready yet. Try again in a moment.")
  }
  outbox.clear = async () => {
    const account = holder.value?.account
    await active.value?.outbox.clear()
    if (readAuthor()?.id === account) forgetAuthor()
  }

  // ViteHub won't change uncertain entries. Local recovery can remove them without deleting a server copy, or edit
  // a refused entry without changing its retry key. Check in the transaction that no tab is currently sending it.
  const revise = async (id: string, change?: (entry: CommentsOutboxEntry) => CommentsOutboxEntry) => {
    const saved = entries.value.find((entry) => entry.id === id)
    const lib = queueFor(id)
    if (!saved || !lib || (change && saved.account === heldHolder.value?.account)) return false
    if (!change && (await lib.dismiss(id))) return true
    const changed = await store.update(saved.account, (drafts) => {
      const entry = drafts.get(id)
      if (!entry || entry.status === "sending" || (change && entry.status !== "failed")) return false
      if (change) drafts.set(id, change(entry))
      else {
        for (const reply of drafts.values())
          if (reply.kind === "reply" && reply.input.threadId === id) drafts.delete(reply.id)
        drafts.delete(id)
      }
      return true
    })
    // Reads the store again and tells the other tabs; a changed entry goes back in the queue.
    if (changed) await lib.retry(id)
    return changed
  }
  outbox.discard = (id) => revise(id)
  outbox.edit = async (id, body, mentions) =>
    (activeEntries.value.some((entry) => entry.id === id) && (await active.value?.outbox.edit(id, body, mentions))) ||
    revise(id, (entry) => {
      const words = { body, ...(mentions ? { mentions } : {}) }
      // Each kind apart, so the entry keeps its own input type.
      return entry.kind === "create"
        ? { ...entry, input: { ...entry.input, ...words } }
        : { ...entry, input: { ...entry.input, ...words } }
    })

  // Who's signed in is known once /api/me first answers; until then nothing goes out as a guest by mistake.
  const known = ref(false)
  watch(
    status,
    (value) => {
      if (value === "success") known.value = true
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
      heldHolder.value = undefined
      holder.value = undefined
      if (id && person) {
        await adoptGuests(store, id).catch((error: unknown) => reportClientError("comments-adopt", error))
        if (turn !== resolving) return
        holder.value = {
          account: id,
          user: { id, name: person.name, ...(person.image ? { image: person.image } : {}) },
          held: false,
        }
      } else {
        const last = readAuthor()
        holder.value = { account: GUEST_ACCOUNT, held: false }
        if (last) heldHolder.value = { account: last.id, user: last, held: true }
      }
    },
    { immediate: true, flush: "sync" },
  )

  function connect(
    owner: Ref<Holder | undefined>,
    client: Ref<Client | undefined>,
    visible: Ref<readonly CommentsOutboxEntry[]>,
  ) {
    watch(
      owner,
      (who, _, onCleanup) => {
        if (!who) return
        const transport = dropTransport({
          fetch: $fetch,
          held: who.held,
          ...(who.account === GUEST_ACCOUNT ? {} : { as: who.account }),
          async created(requestId, drop, comment, threadId) {
            sentHere.add(requestId)
            accepted.set(requestId, threadId)
            const page = pageOf(drop)
            if (page) await page.created(requestId, comment)
            else await refreshNuxtData([keys.comments(drop), keys.review(drop)])
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
        visible.value = next.outbox.entries
        let before = next.outbox.entries
        const stopChange = next.onChange(() => {
          const now = next.outbox.entries
          visible.value = who.held
            ? now.map((entry) => ({
                ...entry,
                status: "pending",
                held: true,
                error: { status: 401, why: "Sign in to send" },
              }))
            : now
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
          if (now.length && who.user && !who.held) writeAuthor(who.user)
          else if (emptied && readAuthor()?.id === who.account) forgetAuthor()
        })
        const stop = next.start()
        // What a 401 held for this person goes out now that they're signed in again. Signed out, it stays held, unless
        // the last of it went out or was discarded while this outbox started.
        if (!who.held) void next.outbox.retry()
        onCleanup(() => {
          stopChange()
          stop()
          client.value = undefined
          visible.value = []
        })
      },
      { immediate: true, flush: "sync" },
    )
  }
  connect(holder, active, activeEntries)
  connect(heldHolder, held, heldEntries)

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
