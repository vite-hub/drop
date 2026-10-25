<script setup lang="ts">
// The drop picked in a folder's list, previewed beside it (Dropbox's and Supabase Storage's pane): images and videos as
// themselves, Markdown, HTML and spreadsheets in a frame with no scripts, the rest by kind. Open goes to its page.
import { planDocument } from "#shared/documents"
import { videoType } from "#shared/plans"
import type { DropDetail, DropSummary } from "#shared/types"

const props = defineProps<{ child: DropSummary; to: string }>()
const emit = defineEmits<{ close: [] }>()
// The viewer's own cache key, so the page opens at once after its preview.
const { data: detail } = useApi<DropDetail>(() => `/api/drops/${props.child.id}`, {
  key: () => keys.drop(props.child.id),
  server: false,
})
const colorMode = useColorMode()
const dark = computed(() => colorMode.value === "dark")
const url = computed(() => detail.value?.url)
const video = computed(() => (props.child.kind === "file" ? videoType(props.child.filename) : undefined))
// `sandbox` with nothing allowed: the doc's own scripts and the viewer's runtime stay off, so it can't reach the app.
// Images a doc embeds load through that runtime, so they wait for the page.
const srcdoc = computed(() => {
  const drop = detail.value
  if (!drop) return ""
  if (drop.kind === "markdown" && drop.html) return planDocument("markdown", drop.content ?? "", dark.value, drop.html)
  if (drop.kind === "html" && drop.content) return planDocument("html", drop.content, dark.value)
  if (drop.kind === "file" && drop.html) return planDocument("file", "", dark.value, drop.html)
  return ""
})
const facts = computed(() =>
  [
    { label: "Kind", value: KIND_LABELS[props.child.kind] },
    props.child.kind === "folder"
      ? { label: "Holds", value: itemCount(props.child.items ?? 0) }
      : props.child.size
        ? { label: "Size", value: formatBytes(props.child.size) }
        : null,
    props.child.owner ? { label: "Owner", value: props.child.owner.name } : null,
    { label: "Added by", value: props.child.actorName },
  ].filter((fact) => fact !== null),
)
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex h-12 shrink-0 items-center gap-2 border-b border-default pr-2 pl-4">
      <p class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted" :title="child.title">{{ child.title }}</p>
      <UTooltip text="Close preview">
        <UButton
          aria-label="Close preview"
          color="neutral"
          icon="i-mingcute-close-line"
          size="sm"
          variant="ghost"
          @click="emit('close')"
        />
      </UTooltip>
    </div>
    <div class="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-muted">
      <img
        v-if="child.kind === 'image' && (url || child.thumbnail)"
        :alt="child.title"
        class="max-h-full max-w-full object-contain p-4"
        :src="url || child.thumbnail"
      />
      <video v-else-if="video && url" class="max-h-full max-w-full" controls preload="metadata">
        <source :src="url" :type="video" />
      </video>
      <iframe
        v-else-if="srcdoc"
        class="absolute inset-0 size-full bg-default"
        sandbox=""
        :srcdoc
        :title="child.title"
      />
      <div v-else class="px-6 text-center">
        <UIcon :name="KIND_ICONS[child.kind]" class="size-10 text-dimmed" />
        <p v-if="detail?.excerpt" class="mt-3 line-clamp-4 text-sm text-muted">{{ detail.excerpt }}</p>
      </div>
    </div>
    <div class="shrink-0 border-t border-default p-4">
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <template v-for="fact in facts" :key="fact.label">
          <dt class="text-muted">{{ fact.label }}</dt>
          <dd class="truncate text-right text-highlighted">{{ fact.value }}</dd>
        </template>
        <dt class="text-muted">Updated</dt>
        <dd class="text-right text-highlighted"><TimeAgo :at="child.updatedAt" /></dd>
      </dl>
      <div class="mt-4 flex gap-2">
        <UButton block class="flex-1" color="neutral" label="Open" size="sm" :to="to" />
        <UButton
          v-if="url && child.kind !== 'folder'"
          aria-label="Download"
          color="neutral"
          :download="child.filename"
          :href="url"
          icon="i-mingcute-download-2-line"
          size="sm"
          variant="outline"
        />
      </div>
    </div>
  </div>
</template>
