<script setup lang="ts">
// A public skill hub's Install button, and on each of its skills' folders: a click copies `npx skills add <hub link>`
// (`--skill <name>` on a skill's folder) and shows the command under the button, with how to update later.
import { skillsAddCommand } from "#shared/links"
import type { SkillInstall } from "#shared/types"

const props = defineProps<{ install: SkillInstall }>()
const origin = useRequestURL().origin
const command = computed(() => skillsAddCommand(origin, props.install))
const label = computed(() => (props.install.skill || props.install.skills === 1 ? "Install skill" : "Install skills"))
</script>

<template>
  <UPopover :content="{ align: 'end', side: 'bottom' }" :ui="{ content: 'w-[min(24rem,calc(100vw-1rem))] rounded-xl' }">
    <DropCopyButton icon="i-mingcute-terminal-box-line" :label="label" size="sm" :value="command" variant="outline" />
    <template #content>
      <div class="flex flex-col gap-1.5 p-3">
        <div class="flex items-start gap-1 rounded-md border border-default bg-muted py-1 pr-1 pl-3">
          <code class="min-w-0 flex-1 py-1 font-mono text-xs break-all text-highlighted">{{ command }}</code>
          <DropCopyButton
            aria-label="Copy command"
            class="hover:bg-inverted/8 active:bg-inverted/12"
            size="sm"
            :value="command"
          />
        </div>
        <p class="px-1 text-xs text-muted">
          Run it in your project. <code class="font-mono">npx skills update</code> gets new versions.
        </p>
      </div>
    </template>
  </UPopover>
</template>
