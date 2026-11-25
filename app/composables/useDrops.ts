import * as v from "valibot"
import type { RouteLocationNormalizedLoaded } from "vue-router"
import type { Lifetime } from "#shared/expiry"
import { dropPath } from "#shared/links"
import type { Share } from "#shared/share"
import type { DropDetail, DropSummary, DropTree, Viewer } from "#shared/types"
import type { EmbedCheck } from "~/utils/private-embeds"

export const useDrops = () => useApi("/api/drops", { key: keys.drops, default: () => [] })

const OpenDrop = v.fallback(v.object({ id: v.optional(v.string()) }), {})

export function useDropTree({ params }: Pick<RouteLocationNormalizedLoaded, "params"> = useRoute()) {
  const { id: open } = v.parse(OpenDrop, params)
  return useApi("/api/drops/tree", {
    key: keys.tree,
    query: open ? { open } : {},
    default: (): DropTree => ({ drops: [], total: 0 }),
  })
}

export function useSidebarDrops() {
  const { data: tree, status } = useDropTree()
  const { data: all } = useNuxtData<DropSummary[]>(keys.drops)
  return {
    drops: computed(() => (all.value?.length ? all.value : tree.value.drops)),
    total: computed(() => all.value?.length || tree.value.total),
    complete: computed(() => Boolean(all.value?.length)),
    status,
  }
}

const LISTS = [keys.drops, keys.tree]

export const useSharedWithMe = () =>
  useApi("/api/drops", { key: keys.sharedWithMe, query: { shared: "1" }, default: () => [] })

type PinConfirmations = Partial<Record<string, { pinned: boolean }>>
const usePinConfirmations = () => useState<PinConfirmations>("pin-confirmations", () => ({}))

export function usePinned() {
  const confirmed = usePinConfirmations()
  const pending = new WeakMap<object, PinConfirmations>()
  return useApi("/api/drops", {
    key: keys.pinned,
    query: { pinned: "1" },
    default: () => [],
    onRequest: ({ options }) => {
      pending.set(options, { ...confirmed.value })
    },
    onResponse: ({ options, response }) => {
      const atStart = pending.get(options)
      if (!atStart || !response.ok || options.signal?.aborted) return
      for (const [id, confirmation] of Object.entries(atStart)) {
        if (confirmed.value[id] === confirmation) delete confirmed.value[id]
      }
    },
  })
}

export function useDropPin(drop: () => DropSummary) {
  const confirmed = usePinConfirmations()
  const { data: pins } = useNuxtData<DropSummary[]>(keys.pinned)
  return computed(() => {
    const { id, pinned } = drop()
    return confirmed.value[id]?.pinned ?? pinned ?? Boolean(pins.value?.some((item) => item.id === id))
  })
}

export const useTrash = () => useApi("/api/drops", { key: keys.trash, query: { trash: "1" }, default: () => [] })

export const useUsage = () => useApi("/api/usage", { key: keys.usage })

export const useFolder = (id: MaybeRefOrGetter<string>) =>
  useApi("/api/drops", {
    key: () => keys.folder(toValue(id)),
    query: computed(() => ({ folder: toValue(id) })),
    default: () => [],
  })

export function useShareUrl(
  drop: MaybeRefOrGetter<Pick<DropSummary, "link" | "slug">>,
  version?: MaybeRefOrGetter<number | undefined>,
) {
  const origin = useRequestURL().origin
  return computed(() => `${origin}${dropPath(toValue(drop), toValue(version))}`)
}

const refresh = () => refreshNuxtData([...LISTS, keys.usage])

const refreshAfterCreate = (parent?: Pick<DropSummary, "id">) =>
  void refreshNuxtData([...LISTS, keys.usage, ...(parent ? [keys.folder(parent.id), keys.drop(parent.id)] : [])])

export function useDropActions() {
  const { data: cached } = useNuxtData<DropSummary[]>(keys.drops)
  const { data: tree } = useNuxtData<DropTree>(keys.tree)
  const { data: me } = useNuxtData<Viewer | null>(keys.me)
  const pinWrites = useState<string[]>("pin-writes", () => [])
  const confirmedPins = usePinConfirmations()
  const edit = (change: (list: DropSummary[]) => DropSummary[]) => {
    if (cached.value) cached.value = change(cached.value)
    if (tree.value) tree.value = { ...tree.value, drops: change(tree.value.drops) }
  }
  const notify = useNotify()
  const confirm = useConfirm()
  const siteDialog = useSiteDialog()
  const nuxtApp = useNuxtApp()
  const folders = () => Object.keys(nuxtApp.payload.data).filter((key) => key.startsWith(keys.folder("")))

  const patch = (id: string, change: Partial<DropSummary>) =>
    edit((list) => list.map((drop) => (drop.id === id ? { ...drop, ...change } : drop)))
  function editDetail(key: string, change: (detail: DropDetail) => DropDetail) {
    if (!(key in nuxtApp.payload.data)) return
    const scope = effectScope(true)
    const data = scope.run(() => useNuxtData<DropDetail>(key).data)!
    const before = data.value
    if (before) data.value = change(before)
    scope.stop()
    return before
  }

  async function upload(
    file: File,
    folder?: Pick<DropSummary, "id" | "title">,
    options: { onProgress?: (fraction: number) => void } = {},
  ) {
    const form = new FormData()
    form.append("file", file)
    if (folder) form.append("folder", folder.id)
    try {
      const { privateEmbeds, uncheckedEmbeds, embedCheckFailed, ...result } = await sendFile(
        "/api/files",
        form,
        v.object({ id: v.string(), ...EmbedCheckSchema }),
        { onProgress: options.onProgress },
      )
      await (folder ? refreshNuxtData([...LISTS, keys.usage, keys.folder(folder.id), keys.drop(folder.id)]) : refresh())
      notify.done(
        folder
          ? `Dropped into ${folder.title}`
          : me.value?.mode === "team"
            ? "Dropped for the team"
            : "Dropped privately",
      )
      notify.privateEmbeds({ privateEmbeds, uncheckedEmbeds, embedCheckFailed })
      return result
    } catch (error) {
      notify.fail("Upload failed", error)
      await refreshNuxtData(keys.usage)
    }
  }

  async function setShare(drop: Pick<DropSummary, "id">, share: Share) {
    const before = [...(cached.value ?? []), ...(tree.value?.drops ?? [])].find((item) => item.id === drop.id)?.share
    patch(drop.id, { share })
    const shown = editDetail(keys.drop(drop.id), (detail) => ({
      ...detail,
      ...(detail.sharedFrom ? { ownShare: share } : { share }),
    }))
    try {
      const { privateEmbeds, uncheckedEmbeds, embedCheckFailed, ...result } = await $fetch<DropSummary & EmbedCheck>(
        `/api/drops/${drop.id}`,
        { method: "PATCH", body: { share } },
      )
      patch(drop.id, result)
      editDetail(keys.drop(drop.id), (detail) => ({ ...detail, sharedFrom: undefined, ownShare: undefined, ...result }))
      void refreshNuxtData([
        keys.sharedWithMe,
        keys.pinned,
        ...folders(),
        ...(result.kind === "folder" ? [keys.drop(drop.id)] : []),
      ])
      notify.privateEmbeds({ privateEmbeds, uncheckedEmbeds, embedCheckFailed })
      return true
    } catch (error) {
      if (before) patch(drop.id, { share: before })
      if (shown) editDetail(keys.drop(drop.id), (detail) => ({ ...shown, pinned: detail.pinned }))
      notify.fail("Couldn't change sharing", error)
      return false
    }
  }

  async function setLifetime(drop: Pick<DropSummary, "id">, change: { lifetime?: Lifetime; renew?: true }) {
    try {
      const result = await $fetch<DropSummary>(`/api/drops/${drop.id}`, { method: "PATCH", body: change })
      patch(drop.id, result)
      await refreshNuxtData([keys.drop(drop.id), keys.pinned])
      return true
    } catch (error) {
      notify.fail("Couldn't change this drop's lifetime", error)
      return false
    }
  }

  async function rename(drop: Pick<DropSummary, "id" | "parentId">, title: string) {
    try {
      const result = await $fetch<DropSummary>(`/api/drops/${drop.id}`, { method: "PATCH", body: { title } })
      patch(drop.id, result)
      await refreshNuxtData([
        keys.drop(drop.id),
        keys.sharedWithMe,
        keys.pinned,
        ...(drop.parentId ? [keys.folder(drop.parentId)] : []),
      ])
      return true
    } catch (error) {
      notify.fail("Couldn't rename it", error)
      return false
    }
  }

  async function setPinned(drop: DropSummary, pinned: boolean, { quiet = false } = {}) {
    if (pinWrites.value.includes(drop.id)) return false
    pinWrites.value = [...pinWrites.value, drop.id]
    try {
      await $fetch(`/api/drops/${drop.id}/pin`, { method: pinned ? "PUT" : "DELETE" })
    } catch (error) {
      notify.fail(pinned ? "Couldn't pin it" : "Couldn't unpin it", error)
      return false
    } finally {
      pinWrites.value = pinWrites.value.filter((id) => id !== drop.id)
    }
    confirmedPins.value[drop.id] = { pinned }
    const currentKey = keys.drop(drop.id)
    for (const key of Object.keys(nuxtApp.payload.data)) {
      if (key === currentKey || key.startsWith(`${currentKey}@`)) editDetail(key, (detail) => ({ ...detail, pinned }))
    }
    void refreshNuxtData(keys.pinned)
    if (!quiet)
      notify.say(pinned ? "Pinned" : "Unpinned", {
        icon: pinned ? "i-mingcute-pin-fill" : "i-mingcute-pin-line",
        action: { label: "Undo", onClick: () => void setPinned(drop, !pinned) },
      })
    return true
  }

  async function remove(drop: Pick<DropSummary, "id" | "title">) {
    try {
      await $fetch(`/api/drops/${drop.id}`, { method: "DELETE" })
      edit((list) => list.filter((item) => item.id !== drop.id))
      await refreshNuxtData([keys.tree, keys.pinned, keys.usage, keys.trash, keys.drop(drop.id), ...folders()])
      notify.say("Moved to the Trash", {
        icon: "i-mingcute-delete-2-line",
        action: { label: "Undo", onClick: () => void restore(drop) },
      })
      return true
    } catch (error) {
      notify.fail("Couldn't move it to the Trash", error)
      return false
    }
  }

  async function restore(drop: Pick<DropSummary, "id" | "title">) {
    try {
      await $fetch(`/api/drops/${drop.id}`, { method: "PATCH", body: { trashed: false } })
      await refreshNuxtData([...LISTS, keys.pinned, keys.trash, keys.usage, keys.drop(drop.id), ...folders()])
      return true
    } catch (error) {
      notify.fail("Couldn't restore", error)
      return false
    }
  }

  async function deleteForever(drop: Pick<DropSummary, "id" | "title"> & { kind?: DropSummary["kind"] }) {
    const what =
      drop.kind === "folder" ? "with everything in it" : "with every version, its comments, and the files it embeds"
    if (
      !(await confirm({
        title: "Delete this drop for good?",
        description: `${drop.title}, ${what}. This can't be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return false
    try {
      await $fetch(`/api/drops/${drop.id}?forever`, { method: "DELETE" })
      clearNuxtData([keys.drop(drop.id), keys.comments(drop.id)])
      await refreshNuxtData([keys.trash, keys.usage])
      return true
    } catch (error) {
      notify.fail("Couldn't delete", error)
      return false
    }
  }

  async function emptyTrash(count: number) {
    if (
      !(await confirm({
        title: "Empty the Trash?",
        description: `${count} ${count === 1 ? "drop" : "drops"}, with every version, comment, and embedded file. This can't be undone.`,
        confirmLabel: "Empty Trash",
        destructive: true,
      }))
    )
      return false
    try {
      await $fetch("/api/trash", { method: "DELETE" })
      await refreshNuxtData([keys.trash, keys.usage])
      return true
    } catch (error) {
      notify.fail("Couldn't empty the Trash", error)
      return false
    }
  }

  async function createFolder(
    title: string,
    parent?: Pick<DropSummary, "id">,
    options: { description?: string; team?: boolean } = {},
  ) {
    try {
      const folder = await $fetch<DropSummary>("/api/folders", {
        method: "POST",
        body: { title, ...(parent ? { folder: parent.id } : {}), ...options },
      })
      await refreshNuxtData([
        ...LISTS,
        keys.sharedWithMe,
        ...(parent ? [keys.folder(parent.id), keys.drop(parent.id)] : []),
      ])
      return folder
    } catch (error) {
      notify.fail("Couldn't create the folder", error)
    }
  }

  async function newSite(parent?: Pick<DropSummary, "id">) {
    const input = await siteDialog()
    if (!input) return
    try {
      const site = await $fetch<DropSummary>("/api/sites", {
        method: "POST",
        body: { ...input, ...(parent ? { folder: parent.id } : {}) },
      })
      refreshAfterCreate(parent ?? (site.parentId ? { id: site.parentId } : undefined))
      await navigateTo(`/drops/${site.id}`)
    } catch (error) {
      notify.fail("Couldn't create the site review", error)
    }
  }

  async function createDoc(parent?: Pick<DropSummary, "id">) {
    try {
      const doc = await $fetch<DropSummary>("/api/drops", {
        method: "POST",
        body: { filename: "untitled.md", title: "Untitled doc", content: "" },
      })
      if (parent) await $fetch(`/api/drops/${doc.id}`, { method: "PATCH", body: { folder: parent.id } })
      refreshAfterCreate(parent)
      return doc
    } catch (error) {
      notify.fail("Couldn't create the doc", error)
    }
  }

  async function createBoard(parent?: Pick<DropSummary, "id">) {
    try {
      const board = await $fetch<DropSummary>("/api/drops", {
        method: "POST",
        body: { filename: "board.excalidraw", title: "Untitled board", content: "" },
      })
      if (parent) await $fetch(`/api/drops/${board.id}`, { method: "PATCH", body: { folder: parent.id } })
      refreshAfterCreate(parent)
      return board
    } catch (error) {
      notify.fail("Couldn't create the board", error)
    }
  }

  async function describe(folder: Pick<DropSummary, "id">, description: string) {
    try {
      const result = await $fetch<DropSummary>(`/api/drops/${folder.id}`, { method: "PATCH", body: { description } })
      patch(folder.id, result)
      await refreshNuxtData([keys.drop(folder.id), keys.sharedWithMe])
      return true
    } catch (error) {
      notify.fail("Couldn't save the description", error)
      return false
    }
  }

  async function move(
    drop: Pick<DropSummary, "id" | "title" | "parentId">,
    folder: Pick<DropSummary, "id" | "title"> | null,
  ) {
    try {
      const moved = await $fetch<DropSummary & EmbedCheck>(`/api/drops/${drop.id}`, {
        method: "PATCH",
        body: { folder: folder?.id ?? null },
      })
      const around = [drop.parentId, folder?.id].flatMap((id) => (id == null ? [] : [keys.drop(id)]))
      await refreshNuxtData([...LISTS, keys.pinned, keys.drop(drop.id), ...around, ...folders()])
      notify.done(folder ? `Moved to ${folder.title}` : "Moved to the top")
      notify.privateEmbeds(moved)
      return true
    } catch (error) {
      notify.fail("Couldn't move it", error)
      return false
    }
  }

  return {
    upload,
    setShare,
    setLifetime,
    rename,
    setPinned,
    remove,
    restore,
    deleteForever,
    emptyTrash,
    createFolder,
    newSite,
    createDoc,
    createBoard,
    describe,
    move,
  }
}
