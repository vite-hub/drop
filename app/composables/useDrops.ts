import { type Lifetime, TRASH_DAYS } from "#shared/expiry"
import type { Access, DropSummary, Visibility } from "#shared/types"

/**
 * Your drops and what you can do to them. The list is one keyed cache ("drops") shared by the sidebar tree
 * and the Drops page; actions patch it after the server agrees, or refresh it when the server computes fields.
 */
export function useDrops() {
  const { data: drops, status, error, refresh } = useApi("/api/drops", { key: "drops", default: () => [] })
  return { drops, status, error, refresh, ...useDropActions() }
}

/**
 * The actions alone, for rows, modals and the viewer: they patch the shared "drops" cache through
 * useNuxtData instead of starting another fetch.
 */
export function useDropActions() {
  const { data: cached } = useNuxtData<DropSummary[]>("drops")
  const drops = computed({ get: () => cached.value ?? [], set: value => (cached.value = value) })
  const refresh = () => refreshNuxtData(["drops", "usage"])
  const notify = useNotify()
  const confirm = useConfirm()

  const patch = (id: string, change: Partial<DropSummary>) => {
    drops.value = drops.value.map(drop => (drop.id === id ? { ...drop, ...change } : drop))
  }

  async function upload(file: File) {
    const form = new FormData()
    form.append("file", file)
    try {
      const result = await $fetch<{ id: string }>("/api/files", { method: "POST", body: form })
      await refresh()
      notify.done("Dropped privately", file.name)
      return result
    }
    catch (error) {
      notify.fail("Upload failed", error)
      await refreshNuxtData("usage")
    }
  }

  // Optimistic: sharing is a toggle, so it flips at once and rolls back if the server says no.
  async function setVisibility(drop: Pick<DropSummary, "id">, visibility: Visibility, access?: Access) {
    const before = drops.value
    patch(drop.id, { visibility, ...(access ? { access } : {}) })
    try {
      const result = await $fetch<DropSummary>(`/api/drops/${drop.id}`, { method: "PATCH", body: { visibility, ...(access ? { access } : {}) } })
      patch(drop.id, result)
      await refreshNuxtData(`drop:${drop.id}`)
      return true
    }
    catch (error) {
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
      await refreshNuxtData(`drop:${drop.id}`)
      return true
    }
    catch (error) {
      notify.fail("Couldn't change this drop's lifetime", error)
      return false
    }
  }

  /** Moves a drop to the Trash at once, with an undo: nothing is lost for 15 days. */
  async function remove(drop: Pick<DropSummary, "id" | "title">) {
    try {
      await $fetch(`/api/drops/${drop.id}`, { method: "DELETE" })
      drops.value = drops.value.filter(item => item.id !== drop.id)
      await refreshNuxtData(["usage", "trash", `drop:${drop.id}`])
      notify.info({ title: "Moved to the Trash", description: `${drop.title} can be restored for ${TRASH_DAYS} days.`, icon: "i-lucide-trash", actions: [{ label: "Undo", color: "neutral", variant: "outline", onClick: () => void restore(drop) }] })
      return true
    }
    catch (error) {
      notify.fail("Couldn't move it to the Trash", error)
      return false
    }
  }

  async function restore(drop: Pick<DropSummary, "id" | "title">) {
    try {
      await $fetch(`/api/drops/${drop.id}`, { method: "PATCH", body: { trashed: false } })
      await refreshNuxtData(["drops", "trash", "usage", `drop:${drop.id}`])
      notify.done("Restored", drop.title)
      return true
    }
    catch (error) {
      notify.fail("Couldn't restore", error)
      return false
    }
  }

  async function deleteForever(drop: Pick<DropSummary, "id" | "title">) {
    if (!await confirm({ title: "Delete this drop for good?", description: `${drop.title}, with every version, its comments, and the files it embeds. This can't be undone.`, confirmLabel: "Delete", destructive: true })) return false
    try {
      await $fetch(`/api/drops/${drop.id}?forever`, { method: "DELETE" })
      clearNuxtData([`drop:${drop.id}`, `comments:${drop.id}`])
      await refreshNuxtData(["trash", "usage"])
      notify.done("Deleted", drop.title)
      return true
    }
    catch (error) {
      notify.fail("Couldn't delete", error)
      return false
    }
  }

  async function emptyTrash(count: number) {
    if (!await confirm({ title: "Empty the Trash?", description: `${count} ${count === 1 ? "drop" : "drops"}, with every version, comment, and embedded file. This can't be undone.`, confirmLabel: "Empty Trash", destructive: true })) return false
    try {
      await $fetch("/api/trash", { method: "DELETE" })
      await refreshNuxtData(["trash", "usage"])
      notify.done("Trash emptied")
      return true
    }
    catch (error) {
      notify.fail("Couldn't empty the Trash", error)
      return false
    }
  }

  return { upload, setVisibility, setLifetime, remove, restore, deleteForever, emptyTrash }
}

export const refreshDrops = () => refreshNuxtData("drops")
