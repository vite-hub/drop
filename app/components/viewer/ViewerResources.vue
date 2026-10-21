<script setup lang="ts">
// The links a drop points to, beside its title: the pull request it documents, that PR's preview. The first few show
// their site's icon and name; the rest wait under +N. Narrower screens show only the icons, and a phone none: the
// header's tools fill it, and Details lists them all.
import type { DropdownMenuItem } from "@nuxt/ui"
import { resourceLabel } from "#shared/resources"
import type { DropResource } from "#shared/types"

const SHOWN = 3
const props = defineProps<{ resources: DropResource[] }>()
const shown = computed(() => props.resources.slice(0, SHOWN))
const more = computed<DropdownMenuItem[]>(() =>
  props.resources.slice(SHOWN).map((resource) => ({
    label: resourceLabel(resource),
    url: resource.url,
    to: resource.url,
    target: "_blank",
    rel: "noopener noreferrer",
  })),
)
</script>

<template>
  <nav aria-label="Links" class="hidden shrink-0 items-center gap-0.5 sm:flex">
    <UTooltip v-for="resource in shown" :key="resource.url" :text="resource.url">
      <UButton
        :aria-label="resourceLabel(resource)"
        class="max-w-44"
        color="neutral"
        rel="noopener noreferrer"
        size="xs"
        target="_blank"
        :to="resource.url"
        variant="ghost"
      >
        <ViewerResourceIcon :url="resource.url" />
        <span class="hidden truncate text-muted lg:inline">{{ resourceLabel(resource) }}</span>
      </UButton>
    </UTooltip>
    <UDropdownMenu v-if="more.length" :content="{ align: 'start' }" :items="more">
      <UButton
        :aria-label="`${more.length} more links`"
        color="neutral"
        :label="`+${more.length}`"
        size="xs"
        :ui="{ label: 'font-mono tabular-nums text-muted' }"
        variant="ghost"
      />
      <template #item-leading="{ item }">
        <ViewerResourceIcon :url="item.url" />
      </template>
    </UDropdownMenu>
  </nav>
</template>
