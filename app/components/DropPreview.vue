<script setup lang="ts">
// A drop drawn small, filling its box (a 16:10 card, a folder's fan, a list's thumbnail): an image as itself, a doc's
// first words on a page, a board's as sticky notes, an app or a reviewed site in a window, a folder fanning out its
// newest drops, an empty folder dashed. Type is sized in container units, so it reads the same at every size. Until its
// peek arrives (usePeek), the kind's icon holds the place at the same size.
import type { DropKind, DropPeek } from "#shared/types"

const { kind, title, peek, address, items, thumbnail } = defineProps<{
  kind: DropKind
  title: string
  peek?: DropPeek | null
  /** A site's address, an app's or a file's name. */
  address?: string
  /** A folder's drop count, known before its peek. */
  items?: number
  thumbnail?: string
}>()
const image = computed(() => thumbnail ?? peek?.thumbnail)
const words = computed(() => peek?.text ?? "")
// A board's words, a few to a note.
const notes = computed(() => {
  const parts = words.value.split(/\s+/).filter(Boolean)
  return [0, 1, 2].map((at) => parts.slice(at * 5, at * 5 + 5).join(" ")).filter(Boolean)
})
const inside = computed(() => peek?.inside ?? [])
const NOTE_PLACES = [
  "left-[8%] top-[12%] -rotate-2 bg-amber-200",
  "left-[46%] top-[30%] rotate-1 bg-sky-200",
  "left-[18%] top-[58%] -rotate-1 bg-emerald-200",
]
const FAN = ["left-[24%] z-30", "left-[8%] top-[18%] z-20 -rotate-6", "left-[40%] top-[18%] z-10 rotate-6"]
</script>

<template>
  <div class="@container relative size-full overflow-hidden">
    <img
      v-if="kind === 'image' && image"
      alt=""
      class="size-full object-cover object-top"
      loading="lazy"
      :src="image"
    />

    <!-- A doc: its title and first words on a page, fading out where the card ends. -->
    <div
      v-else-if="(kind === 'markdown' || kind === 'html') && peek !== undefined"
      class="size-full bg-default px-[8cqw] pt-[7cqw] [mask-image:linear-gradient(to_bottom,#000_60%,transparent)]"
    >
      <p class="line-clamp-2 text-[5.4cqw] leading-tight font-semibold text-pretty text-highlighted">{{ title }}</p>
      <p class="mt-[2.5cqw] text-[3.6cqw] leading-[1.55] text-muted">{{ words || "Nothing written yet." }}</p>
    </div>

    <!-- A board: its words on sticky notes over the dot grid. -->
    <div
      v-else-if="kind === 'board' && peek !== undefined"
      class="relative size-full bg-default bg-[radial-gradient(var(--ui-border)_1px,transparent_1px)] bg-size-[6cqw_6cqw]"
    >
      <p
        v-for="(note, index) in notes"
        :key="index"
        class="absolute w-[36%] p-[2.5cqw] text-[3.6cqw] leading-snug text-neutral-800 shadow-sm"
        :class="NOTE_PLACES[index]"
      >
        {{ note }}
      </p>
      <UIcon
        v-if="!notes.length"
        class="absolute inset-0 m-auto size-[14cqw] text-dimmed"
        name="i-mingcute-drawing-board-line"
      />
    </div>

    <!-- An app or a reviewed site: a window with its name or address in the bar. -->
    <div v-else-if="kind === 'app' || kind === 'site'" class="flex size-full flex-col bg-muted p-[5cqw] pb-0">
      <div
        class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-[2.5cqw] bg-default shadow-xs ring-1 ring-default"
      >
        <div class="flex items-center gap-[1.5cqw] border-b border-default px-[3cqw] py-[2.2cqw]">
          <span v-for="dot in 3" :key="dot" class="size-[2cqw] rounded-full bg-accented" />
          <span class="ml-[2cqw] truncate font-mono text-[3.2cqw] text-muted">{{ address || title }}</span>
        </div>
        <div class="grid flex-1 grid-cols-3 gap-[2.5cqw] p-[4cqw]">
          <span class="col-span-3 h-[5cqw] w-1/2 rounded-[1cqw] bg-accented" />
          <span v-for="block in 3" :key="block" class="h-[14cqw] rounded-[1.5cqw] bg-elevated ring-1 ring-default" />
        </div>
      </div>
    </div>

    <!-- A folder: its newest drops fanned out, how many it holds in the corner; an empty one dashed. -->
    <div
      v-else-if="kind === 'folder' && (items === 0 || (peek && !inside.length))"
      class="grid size-full place-content-center justify-items-center gap-[2cqw] p-[4cqw] text-[4cqw] text-muted"
    >
      <span class="absolute inset-[4cqw] rounded-[2.5cqw] border border-dashed border-accented" />
      <UIcon class="size-[9cqw]" name="i-mingcute-folder-line" />
      Empty folder
    </div>
    <div v-else-if="kind === 'folder' && inside.length" class="relative size-full bg-muted">
      <div
        v-for="(child, index) in inside"
        :key="child.id"
        class="absolute top-[12%] h-full w-[52%] overflow-hidden rounded-[2cqw] bg-default shadow-md ring-1 ring-black/5 dark:ring-white/10"
        :class="FAN[index]"
      >
        <DropPreview :kind="child.kind" :peek="child" :title="child.title" />
      </div>
    </div>

    <!-- Anything else, and every kind until its peek arrives: its icon, and a file's name. -->
    <div
      v-else
      class="grid size-full place-content-center justify-items-center gap-[2cqw] bg-muted px-[6cqw] text-center"
    >
      <UIcon :name="KIND_ICONS[kind]" class="size-[10cqw] text-dimmed" />
      <span v-if="kind === 'file' && address" class="max-w-full truncate font-mono text-[3.6cqw] text-muted">{{
        address
      }}</span>
    </div>
  </div>
</template>
