<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui"

const { signOut } = useUserSession()
// From /api/me, which SSR fetches with the session cookie; the client-side session only exists after hydration.
const { data: me } = useMe()
const colorMode = useColorMode()

const items = computed<DropdownMenuItem[][]>(() => [
  [{ type: "label", slot: "account" as const }],
  [{ label: "Theme", slot: "theme" as const, onSelect: (event: Event) => event.preventDefault() }],
  [{ label: "Sign Out", icon: "i-lucide-log-out", onSelect: () => void leave() }],
])
async function leave() {
  await signOut()
  clearNuxtData()
  await navigateTo("/")
}
const roleLabel = computed(() => ({ admin: "Admin", editor: "Editor", member: "Member" })[me.value?.role ?? "member"])
</script>

<template>
  <UDropdownMenu :items="items" :content="{ side: 'top', align: 'start', sideOffset: 6 }" :ui="{ content: 'w-(--reka-dropdown-menu-trigger-width) min-w-52' }">
    <button class="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-elevated" type="button" aria-label="Account menu">
      <UAvatar :alt="me?.name ?? 'You'" :src="me?.image ?? undefined" size="sm" />
      <span class="min-w-0 flex-1">
        <span class="block truncate text-xs font-medium text-highlighted">{{ me?.name ?? "You" }}</span>
        <span class="block truncate text-xs text-muted">{{ roleLabel }}</span>
      </span>
      <UIcon name="i-lucide-chevrons-up-down" class="size-3.5 shrink-0 text-dimmed" />
    </button>

    <template #account>
      <div class="flex min-w-0 items-center gap-2.5 py-0.5">
        <UAvatar :alt="me?.name ?? 'You'" :src="me?.image ?? undefined" size="sm" />
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-highlighted">{{ me?.name }}</p>
          <p class="truncate text-xs font-normal text-muted">{{ me?.email }}</p>
        </div>
      </div>
    </template>

    <template #theme>
      <div class="flex w-full items-center justify-between gap-3">
        <span>Theme</span>
        <div class="flex items-center rounded-md border border-default p-0.5" role="radiogroup" aria-label="Theme">
          <button
            v-for="option in [{ value: 'light', label: 'Light', icon: 'i-lucide-sun' }, { value: 'dark', label: 'Dark', icon: 'i-lucide-moon' }]"
            :key="option.value"
            :aria-checked="colorMode.value === option.value"
            :aria-label="option.label"
            class="grid h-6 w-7 cursor-pointer place-items-center rounded-[5px] transition-colors"
            :class="colorMode.value === option.value ? 'bg-elevated text-highlighted' : 'text-muted hover:text-highlighted'"
            role="radio"
            type="button"
            @click.stop="colorMode.preference = option.value"
          >
            <UIcon :name="option.icon" class="size-3.5" />
          </button>
        </div>
      </div>
    </template>
  </UDropdownMenu>
</template>
