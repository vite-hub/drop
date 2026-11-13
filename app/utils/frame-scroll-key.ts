/**
 * The scroll key a keydown in Drop's window passes on to the drop's frame, or null when Drop's window uses it.
 *
 * Drop's window doesn't scroll, and under Comments its focus stays there: each click on the page is a comment, and
 * focus goes back to the Comments button after one. So ↑, ↓, Page Up, Page Down, Home, End, and Space would scroll
 * nothing. Passed on, they scroll the page in the frame as they would with the page focused (keyScroll in
 * shared/plan-runtime.ts). A key stays in Drop's window when something there takes it: a field being typed in, a
 * dialog, modal, or menu, a list that scrolls, or a control Space presses.
 *
 * Self-contained, so test/viewer/frame-scroll-key-browser.test.mjs runs it in a page.
 */
export function frameScrollKey(event: KeyboardEvent): { key: string; shift: boolean } | null {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return null
  if (!/^( |ArrowUp|ArrowDown|PageUp|PageDown|Home|End)$/.test(event.key)) return null
  const target = event.target
  if (!(target instanceof Element)) return null
  const page = target.ownerDocument
  // A modal over the page, such as the image lightbox, keeps the page under it still.
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
