import { type Lifetime, TRASH_DAYS } from "#shared/expiry"
import { dropPath } from "#shared/links"
import type { Share } from "#shared/share"
import type { DropSummary, Viewer } from "#shared/types"

/**
 * Your drops. The list is one keyed cache ("drops") shared by the sidebar tree and the Drops page; the actions
 * (useDropActions) patch it after the server agrees, or refresh it when the server computes fields.
 */
export const useDrops = () => useApi("/api/drops", { key: keys.drops, default: () => [] })

/** What others share with you: on a team Drop the team's folders and teammates' drops, on a personal one the public links you opened. */
export const useSharedWithMe = () =>
  useApi("/api/drops", { key: keys.sharedWithMe, query: { shared: 1 }, default: () => [] })

/** The drops directly in a folder, for an expanded row in the tree or the Drops page. Keyed `folder:<id>`. */
export const useFolder = (id: MaybeRefOrGetter<string>) =>
  useApi("/api/drops", {
    key: () => keys.folder(toValue(id)),
    query: computed(() => ({ folder: toValue(id) })),
    default: () => [],
  })

/**
 * A doc's share link, absolute on the server too, so SSR and hydration print the same URL. It opens the latest version;
 * `version` pins one.
 */
export function useShareUrl(
  drop: MaybeRefOrGetter<Pick<DropSummary, "link" | "slug">>,
  version?: MaybeRefOrGetter<number | undefined>,
) {
  const origin = useRequestURL().origin
  return computed(() => `${origin}${dropPath(toValue(drop), toValue(version))}`)
}

/**
 * What you can do to drops, for the page, rows, modals and the viewer: actions patch the shared "drops" cache
 * through useNuxtData instead of starting another fetch.
 */
const refresh = () => refreshNuxtData([keys.drops, keys.usage])

export function useDropActions() {
  const { data: cached } = useNuxtData<DropSummary[]>(keys.drops)
  const { data: me } = useNuxtData<Viewer | null>(keys.me)
  const drops = computed({ get: () => cached.value ?? [], set: (value) => (cached.value = value) })
  const notify = useNotify()
  const confirm = useConfirm()
  // Sharing, trashing or moving a folder changes what its open listings show, so they refetch too.
  const nuxtApp = useNuxtApp()
  const folders = () => Object.keys(nuxtApp.payload.data).filter((key) => key.startsWith(keys.folder("")))

  const patch = (id: string, change: Partial<DropSummary>) => {
    drops.value = drops.value.map((drop) => (drop.id === id ? { ...drop, ...change } : drop))
  }

  /** Uploads one file as a drop with this Drop's default share, or into `folder`, where it shares and lives with the folder. */
  async function upload(file: File, folder?: Pick<DropSummary, "id" | "title">) {
    const form = new FormData()
    form.append("file", file)
    if (folder) form.append("folder", folder.id)
    try {
      const result = await $fetch<{ id: string }>("/api/files", { method: "POST", body: form })
      await (folder
        ? refreshNuxtData([keys.drops, keys.usage, keys.folder(folder.id), keys.drop(folder.id)])
        : refresh())
      notify.done(
        folder
          ? `Dropped into ${folder.title}`
          : me.value?.mode === "team"
            ? "Dropped for the team"
            : "Dropped privately",
        file.name,
      )
      return result
    } catch (error) {
      notify.fail("Upload failed", error)
      await refreshNuxtData(keys.usage)
    }
  }

  // Optimistic: sharing is one pick, so it changes at once and rolls back if the server says no.
  async function setShare(drop: Pick<DropSummary, "id">, share: Share) {
    const before = drops.value
    patch(drop.id, { share })
    try {
      const result = await $fetch<DropSummary>(`/api/drops/${drop.id}`, { method: "PATCH", body: { share } })
      patch(drop.id, result)
      await refreshNuxtData([keys.drop(drop.id), keys.sharedWithMe, ...folders()])
      return true
    } catch (error) {
      drops.value = before
      notify.fail("Couldn't change sharing", error)
      return false
    }
  }

  /** Change how long the drop lives, or renew its window. */
  async function setLifetime(drop: Pick<DropSummary, "id">, change: { lifetime?: Lifetime; renew?: true }) {
    try {
      const result = await $fetch<DropSummary>(`/api/drops/${drop.id}`, { method: "PATCH", body: change })
      patch(drop.id, result)
      await refreshNuxtData(keys.drop(drop.id))
      return true
    } catch (error) {
      notify.fail("Couldn't change this drop's lifetime", error)
      return false
    }
  }

  /** A new name for the drop. Its link keeps its slug. */
  async function rename(drop: Pick<DropSummary, "id" | "parentId">, title: string) {
    try {
      const result = await $fetch<DropSummary>(`/api/drops/${drop.id}`, { method: "PATCH", body: { title } })
      patch(drop.id, result)
      await refreshNuxtData([
        keys.drop(drop.id),
        keys.sharedWithMe,
        ...(drop.parentId ? [keys.folder(drop.parentId)] : []),
      ])
      return true
    } catch (error) {
      notify.fail("Couldn't rename it", error)
      return false
    }
  }

  /** Moves a drop to the Trash at once, with an undo: nothing is lost for 15 days. */
  async function remove(drop: Pick<DropSummary, "id" | "title">) {
    try {
      await $fetch(`/api/drops/${drop.id}`, { method: "DELETE" })
      drops.value = drops.value.filter((item) => item.id !== drop.id)
      await refreshNuxtData([keys.usage, keys.trash, keys.drop(drop.id), ...folders()])
      notify.info({
        title: "Moved to the Trash",
        description: `${drop.title} can be restored for ${TRASH_DAYS} days.`,
        icon: "i-ph-trash",
        actions: [{ label: "Undo", color: "neutral", variant: "outline", onClick: () => void restore(drop) }],
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
      await refreshNuxtData([keys.drops, keys.trash, keys.usage, keys.drop(drop.id), ...folders()])
      notify.done("Restored", drop.title)
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
      notify.done("Deleted", drop.title)
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
      notify.done("Trash emptied")
      return true
    } catch (error) {
      notify.fail("Couldn't empty the Trash", error)
      return false
    }
  }

  /** A new folder at the top, or inside `parent`, with what goes in it. `team` makes one of the team's (admins only). */
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
        keys.drops,
        keys.sharedWithMe,
        ...(parent ? [keys.folder(parent.id), keys.drop(parent.id)] : []),
      ])
      notify.done("Folder created", folder.title)
      return folder
    } catch (error) {
      notify.fail("Couldn't create the folder", error)
    }
  }

  /** A new site review at the top, or inside `parent`, where it lives with the folder. */
  async function createSite(input: { url: string; title?: string }, parent?: Pick<DropSummary, "id">) {
    try {
      const site = await $fetch<DropSummary>("/api/sites", {
        method: "POST",
        body: { ...input, ...(parent ? { folder: parent.id } : {}) },
      })
      await refreshNuxtData([keys.drops, keys.usage, ...(parent ? [keys.folder(parent.id), keys.drop(parent.id)] : [])])
      notify.done("Site review created", site.title)
      return site
    } catch (error) {
      notify.fail("Couldn't create the site review", error)
    }
  }

  /** A folder's description: what goes in it and how, which agents read to pick it. */
  async function describe(folder: Pick<DropSummary, "id">, description: string) {
    try {
      const result = await $fetch<DropSummary>(`/api/drops/${folder.id}`, { method: "PATCH", body: { description } })
      patch(folder.id, result)
      await refreshNuxtData([keys.drop(folder.id), keys.sharedWithMe])
      notify.done("Description saved")
      return true
    } catch (error) {
      notify.fail("Couldn't save the description", error)
      return false
    }
  }

  /** Moves a drop into a folder, or to the top with null. It then shares and lives with the folder. */
  async function move(
    drop: Pick<DropSummary, "id" | "title" | "parentId">,
    folder: Pick<DropSummary, "id" | "title"> | null,
  ) {
    try {
      await $fetch<DropSummary>(`/api/drops/${drop.id}`, { method: "PATCH", body: { folder: folder?.id ?? null } })
      const around = [drop.parentId, folder?.id].flatMap((id) => (id == null ? [] : [keys.drop(id)]))
      await refreshNuxtData([keys.drops, keys.drop(drop.id), ...around, ...folders()])
      notify.done(folder ? `Moved to ${folder.title}` : "Moved to the top", drop.title)
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
    remove,
    restore,
    deleteForever,
    emptyTrash,
    createFolder,
    createSite,
    describe,
    move,
  }
}
