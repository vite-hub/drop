<script setup lang="ts">
import { TYPESET_CSS } from "#shared/typeset"

definePageMeta({ layout: "dashboard", middleware: "auth" })
useSeoMeta({ title: "Skills" })
// Name Tailwind's layer order first: whichever stylesheet declares a layer first fixes the order, and typeset's
// `components` layer must stay after Tailwind's `base` reset.
useHead({ style: [{ key: "typeset", innerHTML: `@layer theme, base, components, utilities;\n${TYPESET_CSS}` }] })

// The catalog agents get over MCP: one row per skill with what it's for; the full SKILL.md opens on demand.
// Members see what's on; admins also see what they switched off, and switch it.
const { data: me } = useMe()
const admin = computed(() => me.value?.role === "admin")
const { skills, status, setEnabled } = useSkills()
const { copy } = useCopy()
const open = ref(new Set<string>())
const toggle = (name: string) => {
  const next = new Set(open.value)
  if (!next.delete(name)) next.add(name)
  open.value = next
}
</script>

<template>
  <PageShell id="skills" title="Skills" description="Instructions your agents load over MCP, alongside Drop's tools.">
    <div v-if="status === 'pending' && !skills.length" class="space-y-3">
      <USkeleton v-for="n in 3" :key="n" class="h-20 w-full" />
    </div>
    <p v-else-if="!skills.length" class="text-sm text-muted">No skills are on. An admin can turn them on here.</p>

    <ul v-else class="divide-y divide-default border-y border-default">
      <li v-for="skill in skills" :key="skill.name" class="py-6">
        <div class="flex items-start justify-between gap-6">
          <div class="min-w-0">
            <h2 class="flex items-center gap-2 text-sm font-medium text-highlighted">
              <span class="font-mono">{{ skill.name }}</span>
              <UBadge v-if="!skill.enabled" color="neutral" variant="subtle" size="sm">Off</UBadge>
            </h2>
            <p class="mt-1.5 max-w-xl text-sm leading-relaxed text-toned">{{ skill.description }}</p>
          </div>
          <USwitch
            v-if="admin"
            class="mt-0.5"
            :model-value="skill.enabled"
            :aria-label="`${skill.enabled ? 'Turn off' : 'Turn on'} ${skill.name}`"
            @update:model-value="value => setEnabled(skill, value)"
          />
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <UButton
            color="neutral"
            variant="outline"
            size="xs"
            :label="open.has(skill.name) ? 'Hide SKILL.md' : 'Read SKILL.md'"
            :trailing-icon="open.has(skill.name) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            :aria-expanded="open.has(skill.name)"
            :aria-controls="`skill-${skill.name}`"
            @click="toggle(skill.name)"
          />
          <a class="inline-flex items-center gap-1 text-xs text-muted hover:text-highlighted" :href="skill.source" target="_blank" rel="noreferrer">
            GitHub<UIcon name="i-lucide-arrow-up-right" class="size-3" />
          </a>
          <button type="button" class="inline-flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted hover:text-highlighted" :aria-label="`Copy ${skill.uri}`" @click="copy(skill.uri, 'Skill URI copied')">
            <span class="truncate">{{ skill.uri }}</span><UIcon name="i-lucide-copy" class="size-3 shrink-0" />
          </button>
        </div>

        <!-- Built-in skill files Drop ships, rendered by its own Markdown pipeline. -->
        <div
          v-if="open.has(skill.name)"
          :id="`skill-${skill.name}`"
          class="skill-body typeset typeset-compact mt-4 rounded-lg border border-default bg-elevated/40 px-5 py-4 text-sm"
          v-html="skill.html"
        />
      </li>
    </ul>
  </PageShell>
</template>

<style scoped>
/* The skill's own text steps back from its description; headings and code keep the strong color. */
.skill-body {
  --color-foreground: var(--ui-text-toned);
}
.skill-body :deep(:is(h2, h3, h4, strong, code)) {
  color: var(--ui-text-highlighted);
}
.skill-body :deep(> :first-child) {
  margin-top: 0;
}
</style>
