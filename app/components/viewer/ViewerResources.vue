<script setup lang="ts">
import { resourceLabel } from "#shared/resources"
import type { DropResource, RelatedDrop } from "#shared/types"

// A drop's own links, and with `relatedTo` the drops related to it through the pages they link to
// (server/utils/related.ts), like a site review's before/after doc, with the links of theirs not listed yet. One list,
// every row alike: a related drop opens here, a link in a new tab.
const props = defineProps<{ resources: DropResource[]; relatedTo?: string }>()
const related = ref<RelatedDrop[]>([])
watch(
  () => props.relatedTo,
  async (id) => {
    related.value = []
    if (!id) return
    const found = await $fetch<RelatedDrop[]>(`/api/drops/${id}/related`).catch(() => [])
    if (props.relatedTo === id) related.value = found
  },
  { immediate: true },
)

// The host goes after a title. Without one, the label is the host or `owner/repo#n`, which already says where it goes.
const label = (resource: DropResource) => {
  const host = new URL(resource.url).hostname.replace(/^www\./, "")
  return { ...resource, label: resourceLabel(resource), host: resource.title ? host : "" }
}
type Row = { key: string; drop?: RelatedDrop; link?: ReturnType<typeof label> }
const rows = computed<Row[]>(() => [
  ...props.resources.map((resource) => ({ key: resource.url, link: label(resource) })),
  ...related.value.flatMap((drop) => [
    { key: drop.id, drop },
    ...drop.links.map((resource) => ({ key: resource.url, link: label(resource) })),
  ]),
])
const count = computed(() => rows.value.length)
// The chips: the drop's own links first, then the related drops' links, then a related drop's kind.
const chipUrls = computed(() => [...props.resources, ...related.value.flatMap((drop) => drop.links)].map((r) => r.url))
const shown = computed(() => chipUrls.value.slice(0, 3))
const more = computed(() => Math.max(0, chipUrls.value.length - shown.value.length))
// The ring takes the pill's fill: its surface, the hover's lighter grey, or white while the list is open. A site icon
// sits on white, as sites draw them for, so a black mark like Airtable's stays visible on the dark pill.
const rings =
  "ring-2 ring-(--ui-bg) group-hover/links:ring-(--ui-bg-elevated) group-focus-visible/links:ring-(--ui-bg-elevated) group-aria-expanded/links:ring-(--ui-bg-inverted)"
// The list rises centered over the whole pill, as the comments panel does, not over the icons at its end.
const trigger = useTemplateRef<HTMLButtonElement>("trigger")
const bar = computed(() => trigger.value?.closest<HTMLElement>('[aria-label="Document tools"]') ?? undefined)
const chip = `${rings} grid size-5 place-items-center rounded-full bg-white inset-ring inset-ring-black/10 [--ui-text-muted:var(--color-neutral-500)]`
</script>

<template>
  <UPopover
    v-if="count"
    :content="{ align: 'center', side: 'top', sideOffset: 8 }"
    :reference="bar"
    :ui="{
      content:
        'w-80 max-w-[calc(100vw-1rem)] max-h-[min(24rem,calc(100dvh-5rem))] overflow-y-auto overscroll-contain rounded-[12px] motion-reduce:animate-none',
    }"
  >
    <template #default="{ open }">
      <UTooltip :disabled="open" text="Related links" :content="{ side: 'top', sideOffset: 8 }">
        <!-- In the review dock, beside Share. Each chip is cut out of the pill's fill by a ring of that fill, so the
             overlap reads on every state of the button; a hairline keeps a white favicon's edge. -->
        <button
          ref="trigger"
          :aria-label="`Related links (${count})`"
          class="group/links shrink-0 px-1.5!"
          type="button"
        >
          <span aria-hidden="true" class="flex -space-x-1">
            <span v-if="!shown.length && related[0]" :class="chip">
              <UIcon class="size-3.5 text-muted" :name="KIND_ICONS[related[0].kind]" />
            </span>
            <span v-for="url in shown" :key="url" :class="[chip, '*:size-3.5!']">
              <ViewerResourceIcon :url="url" />
            </span>
            <span
              v-if="more"
              :class="[
                rings,
                'h-5 min-w-5 rounded-full bg-elevated px-1 text-[0.6875rem] font-medium text-muted tabular-nums',
              ]"
              class="grid place-items-center"
              >+{{ more }}</span
            >
          </span>
        </button>
      </UTooltip>
    </template>
    <template #content="{ close }">
      <nav aria-label="Related links" class="p-1">
        <p class="px-2 pt-1.5 pb-1 text-xs font-medium text-muted">Related links</p>
        <ul>
          <li v-for="row in rows" :key="row.key">
            <NuxtLink
              v-if="row.drop"
              class="flex min-h-8 items-start gap-2 rounded-md px-2 py-1.5 text-sm/5 text-highlighted transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-border-inverted) pointer-coarse:min-h-11"
              :to="`/drops/${row.drop.id}`"
              @click="close"
            >
              <UIcon aria-hidden="true" class="mt-0.5 size-4 shrink-0 text-muted" :name="KIND_ICONS[row.drop.kind]" />
              <span class="min-w-0 flex-1 truncate">{{ row.drop.title }}</span>
            </NuxtLink>
            <a
              v-else-if="row.link"
              class="flex min-h-8 items-start gap-2 rounded-md px-2 py-1.5 text-sm/5 text-highlighted transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-border-inverted) pointer-coarse:min-h-11"
              :href="row.link.url"
              rel="noopener noreferrer"
              target="_blank"
              :title="`${row.link.label}\n${row.link.url}`"
              @click="close"
            >
              <ViewerResourceIcon class="mt-0.5" :url="row.link.url" />
              <span class="min-w-0 flex-1 truncate">{{ row.link.label }}</span>
              <span v-if="row.link.host" class="ml-auto min-w-0 max-w-2/5 truncate pl-2 text-xs/5 text-muted">{{
                row.link.host
              }}</span>
              <UIcon
                aria-hidden="true"
                :class="['mt-0.75 size-3.5 shrink-0 text-dimmed', { 'ml-auto': !row.link.host }]"
                name="i-mingcute-arrow-right-up-line"
              />
              <span class="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        </ul>
      </nav>
    </template>
  </UPopover>
</template>
