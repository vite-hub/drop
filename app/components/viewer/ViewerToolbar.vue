<script setup lang="ts">
// Contextual preview controls inside the shared review dock. HTML/apps expose inspection tools; docs, images, HTML,
// and apps take the Marker; documents and images otherwise only expose pin visibility and supported device sizing.
import type { ViewerOverlays, ViewerTool } from "~/composables/useViewerAnnotations"

const {
  tool,
  overlays = { rulers: false, xray: false, pins: true },
  sizable,
  tools = ["browse", "measure"],
  views = ["rulers", "xray", "pins"],
} = defineProps<{
  tool: ViewerTool
  overlays?: ViewerOverlays
  sizable: boolean
  tools?: readonly ViewerTool[]
  views?: readonly (keyof ViewerOverlays)[]
}>()
const emit = defineEmits<{ tool: [tool: ViewerTool]; toggle: [overlay: keyof ViewerOverlays] }>()

type Item = { id: string; label: string; icon: string; kbd?: string; on: boolean; press: () => void }

const toolItems = computed<Item[]>(() =>
  [
    { value: "browse" as const, label: "Browse", icon: "i-mingcute-cursor-3-line", kbd: "V" },
    { value: "measure" as const, label: "Measure", icon: "i-mingcute-aiming-2-line", kbd: "S" },
    { value: "mark" as const, label: "Marker", icon: "i-mingcute-mark-pen-line", kbd: "B" },
  ].flatMap((item) =>
    tools.includes(item.value)
      ? [
          {
            id: item.value,
            label: item.label,
            icon: item.icon,
            kbd: item.kbd,
            on: tool === item.value,
            press: () => emit("tool", item.value),
          },
        ]
      : [],
  ),
)
const viewItems = computed<Item[]>(() =>
  (
    [
      {
        id: "rulers",
        label: "Rulers and guides",
        icon: "i-mingcute-ruler-line",
        kbd: "U",
        on: overlays.rulers,
        press: () => emit("toggle", "rulers"),
      },
      {
        id: "xray",
        label: "X-ray",
        icon: "i-mingcute-layout-grid-line",
        kbd: "X",
        on: overlays.xray,
        press: () => emit("toggle", "xray"),
      },
      {
        // Pressed means hidden, like the others: pressed is the one that changes the page.
        id: "pins",
        label: "Hide comments",
        icon: overlays.pins ? "i-mingcute-eye-line" : "i-mingcute-eye-close-line",
        on: !overlays.pins,
        press: () => emit("toggle", "pins"),
      },
    ] as const
  ).filter((item) => views.includes(item.id)),
)
const groups = computed(() =>
  [
    { label: "Tools", items: toolItems.value },
    { label: "Views", items: viewItems.value },
  ].filter((group) => group.items.length),
)
</script>

<template>
  <div aria-label="Preview tools" class="flex items-center gap-0.5" role="group">
    <template v-for="(group, index) in groups" :key="group.label">
      <div v-if="index" aria-hidden="true" class="w-1 shrink-0" />
      <div :aria-label="group.label" class="flex items-center gap-0.5" role="group">
        <UTooltip v-for="item in group.items" :key="item.id" :content="{ side: 'top', sideOffset: 8 }">
          <button
            :aria-keyshortcuts="item.kbd"
            :aria-label="item.label"
            :aria-pressed="item.on"
            class="grid size-8 place-items-center rounded-md outline-none select-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-tool/50 motion-safe:transition-[scale,background-color,color] motion-safe:duration-150 motion-safe:ease-out motion-safe:active:scale-[0.96]"
            :class="item.on ? 'bg-tool text-white' : 'text-highlighted hover:bg-elevated'"
            type="button"
            @click="item.press"
          >
            <UIcon aria-hidden="true" class="size-5" :name="item.icon" />
          </button>
          <template #content>
            {{ item.label }}<span v-if="item.kbd" class="ml-1.5 opacity-60">{{ item.kbd }}</span>
          </template>
        </UTooltip>
      </div>
    </template>
    <template v-if="sizable">
      <div v-if="groups.length" aria-hidden="true" class="w-1 shrink-0" />
      <div aria-label="Device" class="flex items-center" role="group">
        <ViewerDeviceButton />
      </div>
    </template>
  </div>
</template>
