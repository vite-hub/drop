import { dropPath } from "#shared/links"
import type { DropDetail, DropGalleryItem } from "#shared/types"

export function useGallery(drop: Ref<DropDetail>, publicView: boolean) {
  const items = computed(() => drop.value.gallery ?? [])
  const going = ref<number>()
  const at = computed(() => going.value ?? items.value.findIndex((item) => item.id === drop.value.id))
  const prev = computed(() => (at.value > 0 ? items.value[at.value - 1] : undefined))
  const next = computed(() => (at.value >= 0 ? items.value[at.value + 1] : undefined))
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
