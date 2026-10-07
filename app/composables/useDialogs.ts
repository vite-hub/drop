import type { GenericSchema } from "valibot"
import { ConfirmModal, PromptModal } from "#components"

/** `await confirm({ title })` instead of window.confirm: same modal, same keyboard handling everywhere. */
export function useConfirm() {
  const overlay = useOverlay()
  let active: { id: symbol; close: () => void } | undefined
  onScopeDispose(() => {
    if (active && overlay.isOpen(active.id)) active.close()
  })
  return async (props: { title: string; description?: string; confirmLabel?: string; destructive?: boolean }) => {
    const modal = overlay.create(ConfirmModal, { destroyOnClose: true })
    active = modal
    const result = await modal.open(props).result
    if (active === modal) active = undefined
    return Boolean(result)
  }
}

/** `await prompt({ title, label })` instead of window.prompt. Resolves null when cancelled. */
export function usePrompt() {
  const overlay = useOverlay()
  let active: { id: symbol; close: () => void } | undefined
  onScopeDispose(() => {
    if (active && overlay.isOpen(active.id)) active.close()
  })
  return async (props: { title: string; label: string; placeholder?: string; initial?: string; confirmLabel?: string; schema?: GenericSchema<string, string> }) => {
    const modal = overlay.create(PromptModal, { destroyOnClose: true })
    active = modal
    const result = await modal.open(props).result
    if (active === modal) active = undefined
    return result ?? null
  }
}
