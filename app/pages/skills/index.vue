<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "auth" })
useSeoMeta({ title: "Skills" })

// The catalog agents get over MCP: one row per skill with what it's for, and the full skill on GitHub.
// Members see what's on; admins also see what they switched off, and switch it.
const { data: me } = useMe()
const admin = computed(() => me.value?.role === "admin")
const { skills, status, setEnabled } = useSkills()
</script>

<template>
  <PageShell id="skills" title="Skills" description="Instructions your agents load over MCP, alongside Drop's tools.">
    <div v-if="status === 'pending' && !skills.length" class="space-y-3">
      <USkeleton v-for="n in 3" :key="n" class="h-20 w-full" />
    </div>
    <p v-else-if="!skills.length" class="text-sm text-muted">No skills are on. An admin can turn them on here.</p>

    <ul v-else class="divide-y divide-default border-y border-default">
      <li v-for="skill in skills" :key="skill.name" class="flex items-start justify-between gap-6 py-6">
        <div class="min-w-0">
          <h2 class="flex items-center gap-2 text-sm font-medium text-highlighted">
            <span class="font-mono">{{ skill.name }}</span>
            <UBadge v-if="!skill.enabled" color="neutral" variant="subtle" size="sm">Off</UBadge>
          </h2>
          <p class="mt-1.5 max-w-xl text-sm leading-relaxed text-toned">{{ skill.description }}</p>
          <a class="mt-3 inline-flex items-center gap-1 text-sm font-medium text-highlighted underline decoration-(--ui-border-accented) underline-offset-4 transition-colors hover:decoration-(--ui-text-highlighted)" :href="skill.source" target="_blank" rel="noreferrer">
            Read on GitHub<UIcon name="i-ph-arrow-up-right" class="size-3.5" />
          </a>
        </div>
        <USwitch
          v-if="admin"
          class="mt-0.5"
          :model-value="skill.enabled"
          :aria-label="`${skill.enabled ? 'Turn off' : 'Turn on'} ${skill.name}`"
          @update:model-value="value => setEnabled(skill, value)"
        />
      </li>
    </ul>
  </PageShell>
</template>
