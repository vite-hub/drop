import type { Component } from "vue"
import { ConfirmModal, PromptModal } from "#components"

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
  return async (props: Parameters<typeof open>[0]) => await open(props) ?? null
}
