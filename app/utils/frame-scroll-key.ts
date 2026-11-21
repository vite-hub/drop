export function frameScrollKey(event: KeyboardEvent): { key: string; shift: boolean } | null {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return null
  if (!/^( |ArrowUp|ArrowDown|PageUp|PageDown|Home|End)$/.test(event.key)) return null
  const target = event.target
  if (!(target instanceof Element)) return null
  const page = target.ownerDocument
  if (page.querySelector("[aria-modal=true]")) return null
  if (event.key === " " && target !== page.body) return null
  if (target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName)))
    return null
  if (target.closest("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]")) return null
  for (let element: Element | null = target; element && element !== page.body; element = element.parentElement) {
    if (
      /^(auto|scroll|overlay)$/.test(getComputedStyle(element).overflowY) &&
      element.scrollHeight > element.clientHeight
    )
      return null
  }
  return { key: event.key, shift: event.shiftKey }
}
