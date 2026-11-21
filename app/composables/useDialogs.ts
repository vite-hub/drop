import type { Component } from "vue"

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

export function useConfirm() {
  const open = useDialog(ConfirmModal)
  return async (props: Parameters<typeof open>[0]) => Boolean(await open(props))
}

export function usePrompt() {
  const open = useDialog(PromptModal)
  return async (props: Parameters<typeof open>[0]) => (await open(props)) ?? null
}

export function useSiteDialog() {
  const open = useDialog(SiteModal)
  return async () => (await open({})) ?? null
}

export function useFolderDialog() {
  const open = useDialog(FolderModal)
  return async (props: Parameters<typeof open>[0] = {}) => (await open(props)) ?? null
}

export function useMoveDialog() {
  const open = useDialog(MoveModal)
  return async (props: Parameters<typeof open>[0]) => Boolean(await open(props))
}
