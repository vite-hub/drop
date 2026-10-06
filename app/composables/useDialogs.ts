import { ConfirmModal, PromptModal } from "#components"

/** `await confirm({ title })` instead of window.confirm: same modal, same keyboard handling everywhere. */
export function useConfirm() {
  const modal = useOverlay().create(ConfirmModal)
  return async (props: { title: string; description?: string; confirmLabel?: string; destructive?: boolean }) => Boolean(await modal.open(props).result)
}

/** `await prompt({ title, label })` instead of window.prompt. Resolves null when cancelled. */
export function usePrompt() {
  const modal = useOverlay().create(PromptModal)
  return async (props: { title: string; label: string; placeholder?: string; initial?: string; confirmLabel?: string }) => (await modal.open(props).result) ?? null
}
