<script setup lang="ts">
// A doc's versions one after the other, newest first, like a commit log: what each one changed (its note), who
// published it, and the comments written on it. A version shows what it changed (ViewerDiff) in place of the document;
// `selected` is the one showing. Each one's link stays on that version, while the doc's link follows the latest.
import { dropPath } from "#shared/links"
import type { DropComment, DropDetail, DropVersion } from "#shared/types"

const props = defineProps<{ drop: DropDetail; comments: DropComment[]; selected?: string }>()
const emit = defineEmits<{ open: [version: DropVersion] }>()
const { copy } = useCopy()
const origin = useRequestURL().origin
const copyLink = (version: DropVersion) =>
  copy(`${origin}${dropPath(props.drop, version.version)}`, `Link to v${version.version} copied`)

// Comments come up to the version being viewed (listComments), so later versions have none to count here.
function talk(version: DropVersion) {
  if (version.version > props.drop.version) return ""
  const written = props.comments.filter((comment) => comment.version === version.version).length
  return written ? `${written} ${written === 1 ? "comment" : "comments"}` : ""
}
</script>

<template>
  <!-- TODO(repo-mirror): once versions also go to a repo the owner picks (@vite-hub/forge, see server/utils/drops.ts),
       link each version to its commit here. -->
  <ol class="p-2">
    <li v-for="(version, index) in drop.versions" :key="version.id" class="group/row relative">
      <span
        v-if="index < drop.versions.length - 1"
        class="absolute top-6 bottom-0 left-[19.5px] w-px translate-y-1.5 bg-(--ui-border)"
        aria-hidden="true"
      />
      <button
        :aria-label="`What changed in v${version.version}`"
        :aria-pressed="selected === version.id"
        class="group relative flex w-full cursor-pointer gap-3 rounded-md py-2.5 pr-11 pl-3 text-left text-sm outline-none hover:bg-elevated focus-visible:ring-2 focus-visible:ring-(--ui-border-inverted) aria-pressed:bg-elevated"
        type="button"
        @click="emit('open', version)"
      >
        <span
          class="mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-(--ui-bg) group-hover:ring-(--ui-bg-elevated) group-aria-pressed:ring-(--ui-bg-elevated)"
          :class="version.current ? 'bg-inverted' : 'bg-accented'"
        />
        <span class="min-w-0 flex-1 space-y-0.5">
          <span class="flex items-center gap-2">
            <span class="font-mono text-xs text-muted">v{{ version.version }}</span>
            <UBadge v-if="version.current" color="neutral" label="Viewing" size="sm" variant="soft" />
          </span>
          <span v-if="version.note || index === drop.versions.length - 1" class="block text-highlighted">{{
            version.note ?? "First version"
          }}</span>
          <span class="block text-xs text-muted"
            >{{ version.actorName }} · <TimeAgo :at="version.createdAt" /><template v-if="talk(version)">
              · {{ talk(version) }}</template
            ></span
          >
        </span>
        <UIcon class="mt-1 size-4 shrink-0 text-dimmed group-hover:text-highlighted" name="i-ph-caret-right" />
      </button>
      <UTooltip :text="`Copy link to v${version.version}`">
        <UButton
          :aria-label="`Copy link to v${version.version}`"
          class="absolute top-1.5 right-1.5 sm:opacity-0 sm:group-hover/row:opacity-100 sm:focus-visible:opacity-100"
          color="neutral"
          icon="i-ph-link"
          size="xs"
          variant="ghost"
          @click="copyLink(version)"
        />
      </UTooltip>
    </li>
  </ol>
</template>
