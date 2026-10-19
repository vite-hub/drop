<script setup lang="ts">
// The vibe-coded app on the landing page, and it really plays: the Drop hand catches falling files.
// It plays itself until someone moves the pointer over it or presses ←/→; then it's theirs.
// Runs only while `running`, and never on its own under reduced motion.
const props = defineProps<{ running: boolean }>()
const emit = defineEmits<{ play: [] }>()

type Item = { id: number; x: number; y: number; speed: number; icon: string }
const ICONS = ["i-ph-file-text", "i-ph-image", "i-ph-code", "i-ph-folder"]
const HAND = 56
const CATCH = 34

const field = useTemplateRef<HTMLElement>("field")
const { width, height } = useElementSize(field)
const motion = usePreferredReducedMotion()

const items = ref<Item[]>([])
const hand = ref(0.5)
const target = ref(0.5)
const score = ref(0)
const best = ref(0)
const manual = ref(false)
const pops = ref<{ id: number; x: number }[]>([])
let nextId = 0
let spawnIn = 0

const active = computed(() => manual.value || (props.running && motion.value !== "reduce"))

const { pause, resume } = useRafFn(({ delta }) => {
  if (!width.value || !height.value) return
  const dt = Math.min(delta, 50) / 1000
  spawnIn -= dt
  if (spawnIn <= 0) {
    spawnIn = 0.55 + Math.random() * 0.45
    items.value.push({ id: nextId++, x: 0.06 + Math.random() * 0.88, y: -24, speed: 110 + Math.random() * 90 + score.value * 2, icon: ICONS[nextId % ICONS.length]! })
  }
  // On its own, the hand chases whichever file will land first.
  if (!manual.value) {
    const lowest = items.value.reduce<Item | undefined>((low, item) => (!low || item.y > low.y ? item : low), undefined)
    if (lowest) target.value = lowest.x
  }
  const step = (520 / width.value) * dt
  hand.value += Math.max(-step, Math.min(step, target.value - hand.value))

  const handY = height.value - 40
  for (const item of items.value) item.y += item.speed * dt
  items.value = items.value.filter((item) => {
    if (item.y >= handY - 16 && item.y <= handY + 8 && Math.abs((item.x - hand.value) * width.value) < CATCH) {
      score.value++
      best.value = Math.max(best.value, score.value)
      pops.value.push({ id: item.id, x: item.x })
      return false
    }
    if (item.y > height.value) {
      if (manual.value) score.value = 0
      return false
    }
    return true
  })
}, { immediate: false })
watch(active, value => (value ? resume() : pause()), { immediate: true })

function take() {
  if (!manual.value) {
    manual.value = true
    score.value = 0
    emit("play")
  }
}
function point(event: PointerEvent) {
  if (!field.value) return
  take()
  const rect = field.value.getBoundingClientRect()
  target.value = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
}
function key(event: KeyboardEvent) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
  event.preventDefault()
  take()
  target.value = Math.max(0, Math.min(1, target.value + (event.key === "ArrowLeft" ? -0.12 : 0.12)))
}
</script>

<template>
  <div
    ref="field"
    tabindex="0"
    role="application"
    aria-label="Catch game: move the pointer or use the left and right arrow keys to catch falling files"
    class="relative h-full cursor-none touch-none overflow-hidden bg-[radial-gradient(var(--ui-border)_1px,transparent_1px)] [background-size:18px_18px] outline-none select-none focus-visible:ring-2 focus-visible:ring-(--ui-border-accented) focus-visible:ring-inset"
    @pointermove="point"
    @pointerdown="point"
    @keydown="key"
  >
    <div class="absolute inset-x-4 top-3 flex items-center justify-between font-mono text-[11px] text-muted">
      <span>Score <span class="text-highlighted tabular-nums">{{ score }}</span></span>
      <span>Best <span class="text-highlighted tabular-nums">{{ best }}</span></span>
    </div>
    <span
      v-for="item in items"
      :key="item.id"
      class="absolute top-0 left-0 grid size-8 place-items-center rounded-md border border-default bg-default text-highlighted shadow-sm"
      :style="{ transform: `translate(${item.x * width - 16}px, ${item.y - 16}px)` }"
    >
      <UIcon :name="item.icon" class="size-4" />
    </span>
    <span
      v-for="pop in pops"
      :key="`pop-${pop.id}`"
      class="absolute font-mono text-xs font-semibold text-highlighted [animation:float-up_600ms_var(--ease-out)_both]"
      :style="{ left: `${pop.x * width}px`, bottom: '64px' }"
      @animationend="pops = pops.filter(other => other.id !== pop.id)"
    >+1</span>
    <DropMark class="absolute bottom-6 left-0 h-10" :style="{ width: `${HAND}px`, transform: `translateX(${hand * width - HAND / 2}px)` }" />
    <p v-if="!manual" class="label-mono absolute inset-x-0 bottom-1.5 text-center text-[10px] text-dimmed">Hover or tap to play</p>
  </div>
</template>
