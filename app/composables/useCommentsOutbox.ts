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
import type { DeliveryClock } from "~/utils/comment-delivery"
import { readOutboxAuthor, writeOutboxAuthor } from "../lib/comment-outbox-storage.client"

interface OutboxPage {
  drop: () => string
  created: (requestId: string, comment: DropComment | null) => void | Promise<void>
  replied: (requestId: string, threadId: string, reply: CommentReply) => void
  refresh: () => Promise<unknown>
}

type Client = CommentsClient & { readonly outbox: CommentsOutbox }

export interface AppCommentsOutbox {
  account: Readonly<Ref<string>>
  author: (account: string) => CommentUser | undefined
  entries: Readonly<Ref<readonly CommentsOutboxEntry[]>>
  heldIds: Readonly<Ref<readonly string[]>>
  accepted: ReadonlyMap<string, string>
  writable: () => Promise<Client>
  ready: () => Client | undefined
  retry: (id: string) => Promise<void>
  discard: (id: string) => Promise<boolean>
  edit: (id: string, body: string, mentions?: string[]) => Promise<boolean>
  attach: (page: OutboxPage) => void
  clear: (account: string) => Promise<void>
  clock: (now: number) => DeliveryClock
}

interface Holder {
  account: string
  user?: CommentUser
  held: boolean
}

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

export function createCommentsOutbox(
  options: { store?: CommentsOutboxStore; environment?: CommentsOutboxEnvironment } = {},
): AppCommentsOutbox {
  const active = shallowRef<Client>()
  const held = shallowRef<Client>()
  const holder = shallowRef<Holder>()
  const heldHolder = shallowRef<Holder>()
  const activeEntries = shallowRef<readonly CommentsOutboxEntry[]>([])
  const heldEntries = shallowRef<readonly CommentsOutboxEntry[]>([])
  const heldIds = computed(() => heldEntries.value.map((entry) => entry.id))
  const pages = new Set<OutboxPage>()
  const accepted = new Map<string, string>()
  const sentHere = new Set<string>()
  const sendingSince = new Map<string, number>()
  const online = useOnline()
  const outbox: AppCommentsOutbox = {
    account: computed(() => holder.value?.account ?? GUEST_ACCOUNT),
    author: (account) => (holder.value?.account === account ? holder.value.user : undefined),
    entries: computed(() => activeEntries.value),
    heldIds,
    accepted,
    writable: async () => {
      throw new Error("Comments can't be written before the page has loaded.")
    },
    ready: () => undefined,
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
    clock: (now) => ({ now, online: online.value, sendingSince: (requestId) => sendingSince.get(requestId) }),
  }
  if (import.meta.server) return outbox

  const notify = useNotify()
  const { data: me, status } = useMe()
  const store = options.store ?? createIndexedDBOutboxStore()
  const pageOf = (drop: string | undefined) => [...pages].find((page) => page.drop() === drop)

  const checked = new WeakSet<Client>()
  const current = (client: Client | undefined, who: Holder | undefined) =>
    client === active.value && who === holder.value && who?.account === (me.value?.id ?? GUEST_ACCOUNT)
  outbox.writable = async () => {
    const client = active.value
    const who = holder.value
    if (client && who) {
      await store.list(who.account)
      if (current(client, who)) {
        if (!store.persisted)
          throw new Error("Allow browser storage before sending comments. Your draft is still here.")
        checked.add(client)
        return client
      }
    }
    throw new Error("Comments aren't ready yet. Try again in a moment.")
  }
  outbox.ready = () => {
    const client = active.value
    return client && checked.has(client) && store.persisted && current(client, holder.value) ? client : undefined
  }
  outbox.clear = async (account) => {
    const client =
      holder.value?.account === account ? active.value : heldHolder.value?.account === account ? held.value : undefined
    if (client) await client.outbox.clear()
    else await store.update(account, (drafts) => drafts.clear())
    if (readOutboxAuthor() === account) writeOutboxAuthor()
  }

  const revise = async (id: string, change?: (entry: CommentsOutboxEntry) => CommentsOutboxEntry) => {
    const isActive = activeEntries.value.some((entry) => entry.id === id)
    const saved = (isActive ? activeEntries.value : heldEntries.value).find((entry) => entry.id === id)
    const lib = (isActive ? active.value : held.value)?.outbox
    if (!saved || !lib || (change && !isActive)) return false
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
    if (changed) await lib.retry(id)
    return changed
  }
  outbox.discard = (id) => revise(id)
  outbox.edit = async (id, body, mentions) =>
    (activeEntries.value.some((entry) => entry.id === id) && (await active.value?.outbox.edit(id, body, mentions))) ||
    revise(id, (entry) => {
      const words = { body, ...(mentions ? { mentions } : {}) }
      return entry.kind === "create"
        ? { ...entry, input: { ...entry.input, ...words } }
        : { ...entry, input: { ...entry.input, ...words } }
    })

  async function resumeAuthorizationHolds(who: Holder, client: Client) {
    for (const entry of await store.list(who.account)) {
      if (active.value !== client || status.value !== "success" || (me.value?.id ?? GUEST_ACCOUNT) !== who.account)
        return
      if (entry.held && entry.error?.status === 401) await client.outbox.retry(entry.id)
    }
  }

  const retryIdentity = () => {
    if (status.value === "error") void refreshNuxtData(keys.me)
  }
  const retryTimer = useTimeoutFn(retryIdentity, 5000, { immediate: false })
  useEventListener(window, "online", retryIdentity)
  watch(
    status,
    (value) => {
      if (value === "error") retryTimer.start()
      else retryTimer.stop()
    },
    { immediate: true },
  )
  let resolving = 0
  let identityFailed = false
  watch(
    [() => me.value?.id, status],
    async ([id, state]) => {
      if (state === "error") identityFailed = true
      if (state !== "success") return
      const recovered = identityFailed
      identityFailed = false
      const who = holder.value
      const client = active.value
      if (who?.account === (id ?? GUEST_ACCOUNT)) {
        if (recovered && client) await resumeAuthorizationHolds(who, client)
        return
      }
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
        const last = readOutboxAuthor()
        holder.value = { account: GUEST_ACCOUNT, held: false }
        if (last) heldHolder.value = { account: last, held: true }
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
            if (quotaFailureOf(error)) notify.problem(error)
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
          visible.value = now
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
          if (now.length && who.user) writeOutboxAuthor(who.account)
          else if (emptied && readOutboxAuthor() === who.account) writeOutboxAuthor()
        })
        const stop = next.start()
        if (!who.held) void resumeAuthorizationHolds(who, next)
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
  watch(active, (client) => client && void outbox.writable().catch(() => undefined), { immediate: true })
  watch(
    activeEntries,
    (entries) => {
      const going = new Set(entries.flatMap((entry) => (entry.status === "sending" ? [entry.requestId] : [])))
      for (const requestId of sendingSince.keys()) if (!going.has(requestId)) sendingSince.delete(requestId)
      for (const requestId of going) if (!sendingSince.has(requestId)) sendingSince.set(requestId, Date.now())
    },
    { immediate: true, flush: "sync" },
  )
  connect(heldHolder, held, heldEntries)

  const guard = (event: Event) => {
    if (activeEntries.value.length || heldIds.value.length) event.preventDefault()
  }
  useEventListener(window, "beforeunload", guard)

  return outbox
}

const outboxes = new WeakMap<object, AppCommentsOutbox>()

export function useCommentsOutbox() {
  const nuxtApp = useNuxtApp()
  const known = outboxes.get(nuxtApp)
  if (known) return known
  const outbox = effectScope(true).run(() => createCommentsOutbox())
  if (!outbox) throw new Error("The comments outbox didn't start.")
  outboxes.set(nuxtApp, outbox)
  return outbox
}
