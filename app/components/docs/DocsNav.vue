<script setup lang="ts">
const route = useRoute()
const active = (to: string) => route.path === to || route.path === `${to}/`
</script>

<template>
  <nav aria-label="Docs" class="space-y-6">
    <div v-for="group in DOCS_NAV" :key="group.title">
      <p class="label-mono mb-2">{{ group.title }}</p>
      <ul class="space-y-px">
        <li v-for="link in group.links" :key="link.to">
          <NuxtLink
            :to="link.to"
            class="flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors"
            :class="active(link.to) ? 'bg-elevated font-medium text-highlighted' : 'text-muted hover:text-highlighted'"
            :aria-current="active(link.to) ? 'page' : undefined"
          >
            <UIcon v-if="link.icon" :name="link.icon" class="size-3.5 shrink-0" />{{ link.label }}
          </NuxtLink>
        </li>
      </ul>
    </div>
  </nav>
</template>
