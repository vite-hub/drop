<script setup lang="ts">
import { resourceLabel } from "#shared/resources"
import type { DropResource, RelatedDrop } from "#shared/types"

// A drop's own links, and with `relatedTo` the drops related to it through the pages they link to
// (server/utils/related.ts), like a site review's before/after doc, each with the links of its not listed above.
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
const links = computed(() => props.resources.map(label))
const sections = computed(() => [
  ...(links.value.length ? [{ drop: undefined, links: links.value }] : []),
  ...related.value.map((drop) => ({ drop, links: drop.links.map(label) })),
])
const count = computed(() => props.resources.length + related.value.length)
// The chips: the drop's own links first, then the related drops' links, then a related drop's kind.
const chipUrls = computed(() => [...props.resources, ...related.value.flatMap((drop) => drop.links)].map((r) => r.url))
const shown = computed(() => chipUrls.value.slice(0, 3))
const more = computed(() => Math.max(0, chipUrls.value.length - shown.value.length))
</script>

<template>
  <UPopover
    v-if="count"
    :content="{ align: 'start', sideOffset: 6 }"
    :ui="{
      content:
        'w-64 max-w-[calc(100vw-1rem)] max-h-[min(24rem,calc(100dvh-5rem))] overflow-y-auto overscroll-contain motion-reduce:animate-none',
    }"
  >
    <template #default="{ open }">
      <UTooltip :disabled="open" text="Related links">
        <!-- Same height as Share (size sm). Each chip is cut out of the button's own fill by a ring of that fill,
             so the overlap reads on every state, and a hairline keeps a white favicon from melting into the bar. -->
        <UButton
          :aria-label="`Related links (${count})`"
          class="group/links shrink-0 px-1 data-open:bg-elevated pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center"
          color="neutral"
          :data-open="open || undefined"
          size="sm"
          variant="ghost"
        >
          <span aria-hidden="true" class="flex -space-x-1">
            <span
              v-if="!shown.length && related[0]"
              class="grid size-5 place-items-center rounded-full bg-default ring-2 ring-(--ui-bg) inset-ring inset-ring-black/10 group-hover/links:ring-(--ui-bg-elevated) group-focus-visible/links:ring-(--ui-bg-elevated) group-data-open/links:ring-(--ui-bg-elevated) dark:bg-elevated dark:inset-ring-white/10"
            >
              <UIcon class="size-3.5 text-muted" :name="KIND_ICONS[related[0].kind]" />
            </span>
            <span
              v-for="url in shown"
              :key="url"
              class="grid size-5 place-items-center rounded-full *:size-3.5! bg-default ring-2 ring-(--ui-bg) inset-ring inset-ring-black/10 transition-[box-shadow] group-hover/links:ring-(--ui-bg-elevated) group-focus-visible/links:ring-(--ui-bg-elevated) group-data-open/links:ring-(--ui-bg-elevated) dark:bg-elevated dark:inset-ring-white/10"
            >
              <ViewerResourceIcon :url="url" />
            </span>
            <span
              v-if="more"
              class="grid h-5 min-w-5 place-items-center rounded-full bg-elevated px-1 text-[0.6875rem] font-medium text-muted tabular-nums ring-2 ring-(--ui-bg) group-hover/links:ring-(--ui-bg-elevated) group-focus-visible/links:ring-(--ui-bg-elevated) group-data-open/links:ring-(--ui-bg-elevated)"
              >+{{ more }}</span
            >
          </span>
        </UButton>
      </UTooltip>
    </template>
    <template #content="{ close }">
      <nav aria-label="Related links" class="p-1">
        <p class="px-2 pt-1.5 pb-1 text-xs font-medium text-muted">Related links</p>
        <!-- The drop's own links, then each related drop, opening here, with its links. -->
        <ul
          v-for="(section, index) in sections"
          :key="section.drop?.id ?? ''"
          :class="{ 'mt-1 border-t border-default pt-1': index }"
        >
          <li v-if="section.drop">
            <NuxtLink
              class="flex min-h-8 items-start gap-2 rounded-md px-2 py-1.5 text-sm/5 font-medium text-highlighted transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-border-inverted) pointer-coarse:min-h-11"
              :to="`/drops/${section.drop.id}`"
              @click="close"
            >
              <UIcon
                aria-hidden="true"
                class="mt-0.5 size-4 shrink-0 text-muted"
                :name="KIND_ICONS[section.drop.kind]"
              />
              <span class="min-w-0 flex-1 truncate">{{ section.drop.title }}</span>
            </NuxtLink>
          </li>
          <li v-for="link in section.links" :key="link.url">
            <a
              class="flex min-h-8 items-start gap-2 rounded-md px-2 py-1.5 text-sm/5 text-highlighted transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-border-inverted) pointer-coarse:min-h-11"
              :href="link.url"
              rel="noopener noreferrer"
              target="_blank"
              :title="`${link.label}\n${link.url}`"
              @click="close"
            >
              <ViewerResourceIcon class="mt-0.5" :url="link.url" />
              <span class="min-w-0 flex-1 truncate">{{ link.label }}</span>
              <span v-if="link.host" class="ml-auto min-w-0 max-w-2/5 truncate pl-2 text-xs/5 text-muted">{{
                link.host
              }}</span>
              <UIcon
                aria-hidden="true"
                :class="['mt-0.75 size-3.5 shrink-0 text-dimmed', { 'ml-auto': !link.host }]"
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
