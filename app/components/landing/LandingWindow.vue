<script setup lang="ts">
// A window on a stage: in front, behind, or gone. A compact stage centers the front one and hides the rest.
// A blank window is already open but empty, like a new tab, until the agent makes what it shows; then the page fades in.
type Frame = { x: number; y: number; w: number; h: number }
const props = defineProps<{ title: string; frame: Frame; state: "front" | "back" | "hidden"; dark?: boolean; url?: boolean; blank?: boolean }>()
const compact = inject(STAGE_COMPACT, ref(false))
defineSlots<{ default(): unknown; icon?(): unknown }>()

const style = computed(() => ({
  left: compact.value ? `calc(50% - ${props.frame.w / 2}px)` : `${props.frame.x}px`,
  top: compact.value ? "0px" : `${props.frame.y}px`,
  width: `${props.frame.w}px`,
  height: `${props.frame.h}px`,
}))
const shown = computed(() => props.state === "front" || (props.state === "back" && !compact.value))
</script>

<template>
  <div
    class="absolute flex flex-col overflow-hidden rounded-xl border shadow-2xl transition-[opacity,transform,filter] duration-700 ease-(--ease-out)"
    :class="[
      dark ? 'border-white/10 bg-[#0f0f10] text-[#c0caf5] shadow-black/30' : 'border-default bg-default shadow-black/10 dark:shadow-black/50',
      state === 'front' ? 'z-20' : 'z-10',
      state === 'back' && ['scale-[.97] after:absolute after:inset-0 after:z-50', dark ? 'after:bg-black/35' : 'after:bg-(--ui-bg)/55'],
      !shown && 'pointer-events-none translate-y-3 scale-[.97] opacity-0',
    ]"
    :style="style"
  >
    <div class="relative flex h-9 shrink-0 items-center gap-1.5 px-3.5" :class="dark ? 'border-b border-white/10 bg-[#18181a]' : 'border-b border-default bg-muted'">
      <span v-for="dot in 3" :key="dot" class="size-2.5 rounded-full" :class="dark ? 'bg-white/15' : 'bg-accented'" />
      <div class="absolute inset-x-24 flex justify-center">
        <span
          class="flex max-w-full items-center gap-1.5 truncate text-xs"
          :class="[dark ? 'text-[#8b8fa3]' : 'text-muted', url && 'h-5 rounded-md border border-default bg-default px-3 py-0.5 font-mono text-[11px]', url && blank && 'w-56']"
        >
          <template v-if="!blank"><slot name="icon" />{{ title }}</template>
        </span>
      </div>
    </div>
    <div class="relative min-h-0 flex-1">
      <div v-if="!blank" class="absolute inset-0 [animation:fade-in_500ms_ease-out]">
        <slot />
      </div>
    </div>
  </div>
</template>
