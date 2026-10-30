import { dropPath } from "#shared/links"
import type { DropDetail, DropGalleryItem } from "#shared/types"

/**
 * An image's folder as a carousel (DropDetail.gallery): the images before and after the one showing, and moving to
 * them with the viewer's side arrows, the strip in its bar (ViewerGallery), ← and →, or a swipe. A move replaces the
 * address, so Back leaves the images for wherever the reader came from.
 */
export function useGallery(drop: Ref<DropDetail>, publicView: boolean) {
  const items = computed(() => drop.value.gallery ?? [])
  // The image a move is on its way to. This viewer shows the old one until the next loads and replaces it, so a second
  // ← or → meanwhile goes on from there, and the strip rings it at once.
  const going = ref<number>()
  const at = computed(() => going.value ?? items.value.findIndex((item) => item.id === drop.value.id))
  const prev = computed(() => (at.value > 0 ? items.value[at.value - 1] : undefined))
  const next = computed(() => (at.value >= 0 ? items.value[at.value + 1] : undefined))
  // In the app for people signed in, at the share link on a public page, as the folder's rows link.
  const to = (item: DropGalleryItem) => (publicView ? dropPath(item) : `/drops/${item.id}`)
  function show(index: number) {
    const item = items.value[index]
    if (!item || index === at.value) return
    going.value = index
    void navigateTo(to(item), { replace: true })
  }
  const step = (by: -1 | 1) => at.value >= 0 && show(at.value + by)
  return { items, at, prev, next, to, show, step }
}
