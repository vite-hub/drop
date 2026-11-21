import type { MaybeElementRef } from "@vueuse/core"
import type { InjectionKey, Ref } from "vue"

export const STAGE_COMPACT: InjectionKey<Readonly<Ref<boolean>>> = Symbol("stage-compact")

export type Beat<Name extends string = string> = readonly [name: Name, ms: number]

export function useStoryboard<Name extends string>(
  target: MaybeElementRef,
  beats: readonly Beat<Name>[],
  options: { still: Name },
) {
  const order = new Map(beats.map(([name], index) => [name, index]))
  const index = ref(0)
  const held = ref(false)
  const visible = useElementVisibility(target)
  const motion = usePreferredReducedMotion()
  const reduced = computed(() => motion.value === "reduce")
  const playing = computed(() => visible.value && !held.value && !reduced.value)

  const { start, stop } = useTimeoutFn(
    () => (index.value = (index.value + 1) % beats.length),
    () => beats[index.value]![1],
    { immediate: false },
  )
  watch(
    [index, playing],
    () => {
      stop()
      if (playing.value) start()
    },
    { immediate: true },
  )
  onMounted(() => watch(reduced, (value) => value && (index.value = order.get(options.still)!), { immediate: true }))

  const beat = computed(() => beats[index.value]![0])
  return {
    beat,
    index,
    held,
    playing,
    reduced,
    at: (name: Name) => index.value >= order.get(name)!,
    go: (name: Name) => (index.value = order.get(name)!),
    indexOf: (name: Name) => order.get(name)!,
  }
}

export function useCursorTarget(
  root: Readonly<Ref<HTMLElement | null>>,
  name: () => string | null | undefined,
  anchor = { x: 0.6, y: 0.65 },
) {
  const position = reactive({ x: 0, y: 0, shown: false })
  if (import.meta.server) return position
  function measure(target: string | null | undefined) {
    const element = target ? root.value?.querySelector<HTMLElement>(`[data-cursor="${target}"]`) : null
    if (!root.value || !element) return void (position.shown = false)
    const frame = root.value.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    const scale = frame.width / root.value.offsetWidth || 1
    position.x = (box.left - frame.left + box.width * anchor.x) / scale
    position.y = (box.top - frame.top + box.height * anchor.y) / scale
    position.shown = true
  }
  const { start } = useTimeoutFn(() => measure(name()), 760, { immediate: false })
  watch(
    name,
    async (next) => {
      await nextTick()
      measure(next)
      start()
    },
    { immediate: true, flush: "post" },
  )
  return position
}
