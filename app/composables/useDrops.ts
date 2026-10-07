import type { Access, DropSummary, Visibility } from "#shared/types"

/**
 * Your drops and what you can do to them. The list is one keyed cache ("drops") shared by the sidebar tree
 * and the Drops page; actions patch it after the server agrees, or refresh it when the server computes fields.
 */
export function useDrops() {
  const { data: drops, status, error, refresh } = useApi<DropSummary[]>("/api/drops", { key: "drops", default: () => [] })
  return { drops, status, error, refresh, ...useDropActions() }
}

/**
 * The actions alone, for rows, modals and the viewer: they patch the shared "drops" cache through
 * useNuxtData instead of starting another fetch.
 */
export function useDropActions() {
  const { data: cached } = useNuxtData<DropSummary[]>("drops")
  const drops = computed({ get: () => cached.value ?? [], set: value => (cached.value = value) })
  const refresh = () => refreshNuxtData("drops")
  const notify = useNotify()
  const confirm = useConfirm()

  const patch = (id: string, change: Partial<DropSummary>) => {
    drops.value = drops.value.map(drop => (drop.id === id ? { ...drop, ...change } : drop))
  }

  async function create() {
    try {
      const drop = await $fetch<DropSummary>("/api/drops", { method: "POST", body: { filename: "untitled.md", title: "Untitled", content: "# Untitled\n\n" } })
      await refresh()
      return drop
    }
    catch (error) {
      notify.fail("Couldn't create a drop", error)
    }
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
    }
  }

  // Optimistic: sharing is a toggle, so it flips at once and rolls back if the server says no.
  async function setVisibility(drop: Pick<DropSummary, "id">, visibility: Visibility, access?: Access) {
    const before = drops.value
    patch(drop.id, { visibility, ...(access ? { access } : {}) })
    try {
      await $fetch(`/api/drops/${drop.id}`, { method: "PATCH", body: { visibility, ...(access ? { access } : {}) } })
      await refreshNuxtData(`drop:${drop.id}`)
      return true
    }
    catch (error) {
      drops.value = before
      notify.fail("Couldn't change sharing", error)
      return false
    }
  }

  async function remove(drop: Pick<DropSummary, "id" | "title">) {
    if (!await confirm({ title: "Delete this drop?", description: `${drop.title}. Its link stops working and its comments go with it.`, confirmLabel: "Delete", destructive: true })) return false
    try {
      await $fetch(`/api/drops/${drop.id}`, { method: "DELETE" })
      drops.value = drops.value.filter(item => item.id !== drop.id)
      clearNuxtData([`drop:${drop.id}`, `comments:${drop.id}`])
      notify.done("Drop deleted", "Its link no longer works.")
      return true
    }
    catch (error) {
      notify.fail("Couldn't delete", error)
      return false
    }
  }

  return { create, upload, setVisibility, remove }
}

export const refreshDrops = () => refreshNuxtData("drops")
