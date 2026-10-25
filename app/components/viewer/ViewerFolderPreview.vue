<script setup lang="ts">
// The drop picked in a folder's list, previewed beside it (Dropbox's and Supabase Storage's pane): images and videos as
// themselves, Markdown, HTML and spreadsheets in a frame with no scripts, the rest by kind. Its name sits on top with
// what it is under it, and double-clicking the name renames it (`renames`); who added it, and when, sits by Open.
import { planDocument } from "#shared/documents"
import { videoType } from "#shared/plans"
import type { DropDetail, DropSummary } from "#shared/types"

const props = defineProps<{ child: DropSummary; to: string; title: string; renames?: boolean }>()
const emit = defineEmits<{ close: []; rename: [title: string | null] }>()
const renaming = ref(false)
function renamed(title: string | null) {
  renaming.value = false
  emit("rename", title)
}
// The viewer's own cache key, so the page opens at once after its preview.
const { data: detail } = useApi<DropDetail>(() => `/api/drops/${props.child.id}`, {
  key: () => keys.drop(props.child.id),
  server: false,
})
const link = useShareUrl(() => props.child)
const { copy, copied } = useCopy()
const colorMode = useColorMode()
const dark = computed(() => colorMode.value === "dark")
const url = computed(() => detail.value?.url)
const video = computed(() => (props.child.kind === "file" ? videoType(props.child.filename) : undefined))
// `sandbox` with nothing allowed: the doc's own scripts and the viewer's runtime stay off, so it can't reach the app.
// Images a doc embeds load through that runtime, so they wait for the page. A Markdown doc reads smaller here, edge to
// edge of the pane: its page keeps the reading size.
const COMPACT_CSS =
  "<style>main{width:auto;padding:1rem 1.25rem 2rem}.typeset{font-size:.875rem;--typeset-leading:1.6}</style>"
const srcdoc = computed(() => {
  const drop = detail.value
  if (!drop) return ""
  if (drop.kind === "markdown" && drop.html)
    return planDocument("markdown", drop.content ?? "", dark.value, drop.html).replace(
      "</head>",
      `${COMPACT_CSS}</head>`,
    )
  if (drop.kind === "html" && drop.content) return planDocument("html", drop.content, dark.value)
  if (drop.kind === "file" && drop.html) return planDocument("file", "", dark.value, drop.html)
  return ""
})
// What it is, in one line under its name: "Image · 1.13 MB", a folder's count, whose it is when it isn't yours.
const about = computed(() =>
  [
    KIND_LABELS[props.child.kind],
    props.child.kind === "folder"
      ? itemCount(props.child.items ?? 0)
      : props.child.size
        ? formatBytes(props.child.size)
        : null,
    props.child.owner?.name,
  ]
    .filter(Boolean)
    .join(" · "),
)
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex shrink-0 items-start gap-2 border-b border-default py-2.5 pr-2 pl-4">
      <div class="min-w-0 flex-1">
        <ViewerRename v-if="renaming" :label="`Rename ${title}`" :title @done="renamed" />
        <p
          v-else
          class="truncate text-sm font-medium text-highlighted"
          :class="renames && 'cursor-text'"
          :title="renames ? `${title} · Double-click to rename` : title"
          @dblclick="renaming = Boolean(renames)"
        >
          {{ title }}
        </p>
        <p class="mt-0.5 truncate text-xs text-muted">{{ about }}</p>
      </div>
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
    <div class="shrink-0 space-y-3 border-t border-default p-3">
      <p class="flex min-w-0 items-center gap-1.5 px-1 text-xs text-muted">
        <AgentIcon class="size-3.5" :kind="child.actorKind" :name="child.actorName" />
        <span class="min-w-0 truncate"
          ><span class="text-default">{{ child.actorName }}</span> {{ child.version > 1 ? "updated it" : "added it" }}
          <TimeAgo :at="child.updatedAt"
        /></span>
      </p>
      <div class="flex gap-2">
        <UButton block class="flex-1" color="neutral" label="Open" size="sm" :to="to" />
        <UTooltip text="Copy link">
          <UButton
            aria-label="Copy link"
            color="neutral"
            :icon="copied('link') ? 'i-mingcute-check-line' : 'i-mingcute-link-line'"
            size="sm"
            variant="outline"
            @click="copy(link, { key: 'link' })"
          />
        </UTooltip>
        <UTooltip v-if="url && child.kind !== 'folder'" text="Download">
          <UButton
            aria-label="Download"
            color="neutral"
            :download="child.filename"
            :href="url"
            icon="i-mingcute-download-2-line"
            size="sm"
            variant="outline"
          />
        </UTooltip>
      </div>
    </div>
  </div>
</template>
