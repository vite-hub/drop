<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "auth" })
useSeoMeta({ title: "Skills" })

// The catalog agents get over MCP. Members see what's on; admins also see what they switched off, and switch it.
const { data: me } = useMe()
const admin = computed(() => me.value?.role === "admin")
const { skills, status, setEnabled } = useSkills()
</script>

<template>
  <PageShell id="skills" title="Skills" description="Instructions your agents load over MCP, alongside Drop's tools. Open a skill to read every file it ships.">
    <ul class="grid gap-3 sm:grid-cols-2">
      <li v-if="status === 'pending' && !skills.length" class="sm:col-span-2">
        <USkeleton class="h-28 w-full" />
      </li>
      <li v-else-if="!skills.length" class="rounded-lg border border-default px-4 py-8 text-center text-sm text-muted sm:col-span-2">
        No skills are on. An admin can turn them on here.
      </li>
      <li v-for="skill in skills" :key="skill.name" class="group relative flex flex-col rounded-lg border border-default p-4 transition-colors hover:bg-elevated/50" :class="!skill.enabled && 'opacity-70'">
        <div class="flex items-start justify-between gap-3">
          <NuxtLink :to="`/skills/${skill.name}`" class="min-w-0 font-mono text-sm font-medium text-highlighted after:absolute after:inset-0 after:content-['']">
            {{ skill.name }}
          </NuxtLink>
          <USwitch
            v-if="admin"
            class="relative z-10"
            :model-value="skill.enabled"
            :aria-label="`${skill.enabled ? 'Turn off' : 'Turn on'} ${skill.name}`"
            @update:model-value="value => setEnabled(skill, value)"
          />
        </div>
        <p class="mt-2 line-clamp-3 text-sm text-muted">{{ skill.description }}</p>
        <div class="mt-auto flex items-center gap-2 pt-4 text-xs text-muted">
          <UBadge :color="skill.enabled ? 'success' : 'neutral'" variant="subtle" size="sm">{{ skill.enabled ? "On" : "Off" }}</UBadge>
          <span>{{ skill.files === 1 ? "1 file" : `${skill.files} files` }}</span>
        </div>
      </li>
    </ul>
  </PageShell>
</template>
