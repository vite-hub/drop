<script setup lang="ts">
// A public skill hub's Install button, and on each of its skills' folders: a click copies `npx skills add <hub link>`
// (`--skill <name>` on a skill's folder) and shows the command under the button, with how to update later.
import { skillsAddCommand } from "#shared/links"
import type { SkillInstall } from "#shared/types"

const props = defineProps<{ install: SkillInstall }>()
const { copy, copied } = useCopy()
const origin = useRequestURL().origin
const command = computed(() => skillsAddCommand(origin, props.install))
const label = computed(() => (props.install.skill || props.install.skills === 1 ? "Install skill" : "Install skills"))
</script>

<template>
  <UPopover :content="{ align: 'end', side: 'bottom' }" :ui="{ content: 'w-[min(24rem,calc(100vw-1rem))] rounded-xl' }">
    <UButton
      color="neutral"
      :icon="copied() ? 'i-mingcute-check-line' : 'i-mingcute-terminal-box-line'"
      :label="label"
      size="sm"
      :ui="{ leadingIcon: copied() ? 'animate-icon-in' : undefined }"
      variant="outline"
      @click="copy(command)"
    />
    <template #content>
      <div class="flex flex-col gap-1.5 p-3">
        <div class="flex items-start gap-1 rounded-md border border-default bg-muted py-1 pr-1 pl-3">
          <code class="min-w-0 flex-1 py-1 font-mono text-xs break-all text-highlighted">{{ command }}</code>
          <UButton
            :aria-label="copied() ? 'Command copied' : 'Copy command'"
            class="hover:bg-inverted/8 active:bg-inverted/12"
            color="neutral"
            :icon="copied() ? 'i-mingcute-check-line' : 'i-mingcute-copy-2-line'"
            size="sm"
            :ui="{ leadingIcon: copied() ? 'animate-icon-in' : undefined }"
            variant="ghost"
            @click="copy(command)"
          />
        </div>
        <p aria-live="polite" class="px-1 text-xs text-muted">
          {{ copied() ? "Copied. " : "" }}Run it in your project. <code class="font-mono">npx skills update</code> gets
          new versions.
        </p>
      </div>
    </template>
  </UPopover>
</template>
