<script setup lang="ts">
import { TYPESET_CSS } from "#shared/typeset"

definePageMeta({ layout: "dashboard", middleware: "auth" })
useSeoMeta({ title: "Skills" })
// Name Tailwind's layer order first: whichever stylesheet declares a layer first fixes the order, and typeset's
// `components` layer must stay after Tailwind's `base` reset.
useHead({ style: [{ key: "typeset", innerHTML: `@layer theme, base, components, utilities;\n${TYPESET_CSS}` }] })

// The catalog agents get over MCP, one skill per row. Members see what's on; admins also see what they
// switched off, and switch it.
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
      <USkeleton v-for="n in 3" :key="n" class="h-24 w-full" />
    </div>
    <p v-else-if="!skills.length" class="text-sm text-muted">No skills are on. An admin can turn them on here.</p>

    <div v-else class="divide-y divide-default">
      <article v-for="skill in skills" :key="skill.name" class="py-8 first:pt-0 last:pb-0">
        <header class="flex items-start justify-between gap-6">
          <div class="min-w-0">
            <h2 class="flex items-center gap-2 font-mono text-sm font-medium text-highlighted">
              {{ skill.name }}
              <span v-if="!skill.enabled" class="font-sans text-xs font-normal text-muted">Off</span>
            </h2>
            <p class="mt-1 max-w-2xl text-sm text-muted">{{ skill.description }}</p>
          </div>
          <USwitch
            v-if="admin"
            size="sm"
            :model-value="skill.enabled"
            :aria-label="`${skill.enabled ? 'Turn off' : 'Turn on'} ${skill.name}`"
            @update:model-value="value => setEnabled(skill, value)"
          />
        </header>

        <div class="relative mt-5" :class="!skill.enabled && 'opacity-60'">
          <!-- Built-in skill files Drop ships, rendered by its own Markdown pipeline. -->
          <div :id="`skill-${skill.name}`" class="skill-body typeset typeset-compact overflow-hidden text-sm" :class="open.has(skill.name) ? '' : 'max-h-56'" v-html="skill.html" />
          <div v-if="!open.has(skill.name)" class="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-b from-transparent to-(--ui-bg)" />
        </div>

        <footer class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <button type="button" class="inline-flex items-center gap-1 text-highlighted hover:underline" :aria-expanded="open.has(skill.name)" :aria-controls="`skill-${skill.name}`" @click="toggle(skill.name)">
            {{ open.has(skill.name) ? "Show less" : "Show more" }}
            <UIcon :name="open.has(skill.name) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3.5" />
          </button>
          <a class="inline-flex items-center gap-1 text-muted hover:text-highlighted" :href="skill.source" target="_blank" rel="noreferrer">
            SKILL.md on GitHub<UIcon name="i-lucide-arrow-up-right" class="size-3.5" />
          </a>
          <button type="button" class="inline-flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted hover:text-highlighted" :aria-label="`Copy ${skill.uri}`" @click="copy(skill.uri, 'Skill URI copied')">
            <span class="truncate">{{ skill.uri }}</span><UIcon name="i-lucide-copy" class="size-3.5 shrink-0" />
          </button>
        </footer>
      </article>
    </div>
  </PageShell>
</template>

<style scoped>
/* Body copy steps back like the rest of the dashboard; headings and code keep the strong color. */
.skill-body {
  --color-foreground: var(--ui-text-toned);
}
.skill-body :deep(:is(h2, h3, h4, strong, code)) {
  color: var(--ui-text-highlighted);
}
</style>
