import type { MaybeElementRef } from "@vueuse/core"

export type Beat<Name extends string = string> = readonly [name: Name, ms: number]

/**
 * Plays named beats in order, on a loop: the scripted landing animations.
 * Waits while the stage is off screen or `held`, and under reduced motion parks on `still`;
 * go() still moves between beats, so chapter buttons work either way.
 */
export function useStoryboard<Name extends string>(target: MaybeElementRef, beats: readonly Beat<Name>[], options: { still: Name }) {
  const order = new Map(beats.map(([name], index) => [name, index]))
  const index = ref(0)
  const held = ref(false)
  const visible = useElementVisibility(target)
  const motion = usePreferredReducedMotion()
  const reduced = computed(() => motion.value === "reduce")
  const playing = computed(() => visible.value && !held.value && !reduced.value)

  const { start, stop } = useTimeoutFn(() => (index.value = (index.value + 1) % beats.length), () => beats[index.value]![1], { immediate: false })
  watch([index, playing], () => (stop(), playing.value && start()), { immediate: true })
  onMounted(() => watch(reduced, value => value && (index.value = order.get(options.still)!), { immediate: true }))

  const beat = computed(() => beats[index.value]![0])
  return {
    beat,
    index,
    held,
    playing,
    reduced,
    /** True from this beat on, until the loop restarts. */
    at: (name: Name) => index.value >= order.get(name)!,
    go: (name: Name) => (index.value = order.get(name)!),
    indexOf: (name: Name) => order.get(name)!,
  }
}

/**
 * Where a scripted cursor should sit: the element marked `data-cursor="<name>"` inside `root`,
 * in the root's own unscaled pixels (stages are scaled with a transform). Re-measures when the name changes.
 */
export function useCursorTarget(root: Readonly<Ref<HTMLElement | null>>, name: () => string | null | undefined, anchor = { x: 0.6, y: 0.65 }) {
  const position = reactive({ x: 0, y: 0, shown: false })
  watch(name, async (next) => {
    await nextTick()
    const element = next ? root.value?.querySelector<HTMLElement>(`[data-cursor="${next}"]`) : null
    if (!root.value || !element) return void (position.shown = false)
    const frame = root.value.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    const scale = frame.width / root.value.offsetWidth || 1
    position.x = (box.left - frame.left + box.width * anchor.x) / scale
    position.y = (box.top - frame.top + box.height * anchor.y) / scale
    position.shown = true
  }, { immediate: true, flush: "post" })
  return position
}
