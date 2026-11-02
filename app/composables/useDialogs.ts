import type { Component } from "vue"

// Each dialog loads when it first opens. Imported here, they and the folder picker's search (Fuse, a virtual list) would
// load with every page: the app's entry needs useConfirm, and this module shares a chunk with it.
const ConfirmModal = defineAsyncComponent(() => import("~/components/ConfirmModal.vue"))
const PromptModal = defineAsyncComponent(() => import("~/components/PromptModal.vue"))
const SiteModal = defineAsyncComponent(() => import("~/components/SiteModal.vue"))
const FolderModal = defineAsyncComponent(() => import("~/components/FolderModal.vue"))
const MoveModal = defineAsyncComponent(() => import("~/components/MoveModal.vue"))

function useDialog<T extends Component>(component: T) {
  const overlay = useOverlay()
  const create = () => overlay.create(component, { destroyOnClose: true })
  const active = new Set<ReturnType<typeof create>>()
  onScopeDispose(() => {
    for (const modal of active) modal.close()
  })
  return (props: NonNullable<Parameters<ReturnType<typeof create>["open"]>[0]>) => {
    const modal = create()
    active.add(modal)
    return modal.open(props).result.finally(() => active.delete(modal))
  }
}

/** `await confirm({ title })` instead of window.confirm: same modal, same keyboard handling everywhere. */
export function useConfirm() {
  const open = useDialog(ConfirmModal)
  return async (props: Parameters<typeof open>[0]) => Boolean(await open(props))
}

/** `await prompt({ title, label })` instead of window.prompt. Resolves null when cancelled. */
export function usePrompt() {
  const open = useDialog(PromptModal)
  return async (props: Parameters<typeof open>[0]) => (await open(props)) ?? null
}

/** `await siteDialog()`: the address and name of a new site review, or null when cancelled. */
export function useSiteDialog() {
  const open = useDialog(SiteModal)
  return async () => (await open({})) ?? null
}

/** `await folderDialog({ offerTeam })`: a new folder's name, description, and whether it's the team's; null when cancelled. */
export function useFolderDialog() {
  const open = useDialog(FolderModal)
  return async (props: Parameters<typeof open>[0] = {}) => (await open(props)) ?? null
}

/** `await moveTo({ drop })`: pick a folder for the drop, or the top. Resolves true once it moved. */
export function useMoveDialog() {
  const open = useDialog(MoveModal)
  return async (props: Parameters<typeof open>[0]) => Boolean(await open(props))
}
