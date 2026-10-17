<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui"

const { signOut } = useUserSession(useNuxtApp().$auth)
// From /api/me, which SSR fetches with the session cookie; the client-side session only exists after hydration.
const { data: me } = useMe()

const items = computed<DropdownMenuItem[][]>(() => [
  [{ type: "label", slot: "account" as const }],
  [{ label: "Theme", slot: "theme" as const, onSelect: (event: Event) => event.preventDefault() }],
  [{ label: "Sign out", icon: "i-ph-sign-out", onSelect: () => void leave() }],
])
async function leave() {
  await signOut()
  // Leave first: cleared data would flash the dashboard's empty defaults for a frame.
  await navigateTo("/")
  clearNuxtData()
}
const roleLabel = computed(() => ({ admin: "Admin", editor: "Editor", member: "Member" })[me.value?.role ?? "member"])
</script>

<template>
  <UDropdownMenu :items="items" :content="{ side: 'top', align: 'start', sideOffset: 6 }" :ui="{ content: 'w-(--reka-dropdown-menu-trigger-width) min-w-52' }">
    <!-- shadcn's NavUser: a large sidebar button with the avatar, name and role. -->
    <button class="flex h-12 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-elevated data-[state=open]:bg-elevated" type="button" aria-label="Account menu">
      <UAvatar :alt="me?.name ?? 'You'" class="rounded-lg" :src="me?.image ?? undefined" size="md" />
      <span class="min-w-0 flex-1 leading-tight">
        <span class="block truncate text-sm font-medium text-highlighted">{{ me?.name ?? "You" }}</span>
        <span class="block truncate text-xs text-muted">{{ roleLabel }}</span>
      </span>
      <UIcon name="i-ph-caret-up-down" class="size-4 shrink-0 text-dimmed" />
    </button>

    <template #account>
      <div class="flex min-w-0 items-center gap-2.5 py-0.5">
        <UAvatar :alt="me?.name ?? 'You'" class="rounded-lg" :src="me?.image ?? undefined" size="md" />
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-highlighted">{{ me?.name }}</p>
          <p class="truncate text-xs font-normal text-muted">{{ me?.email }}</p>
        </div>
      </div>
    </template>

    <template #theme>
      <div class="flex w-full items-center justify-between gap-3">
        <span>Theme</span>
        <UColorModeSwitch size="sm" @click.stop />
      </div>
    </template>
  </UDropdownMenu>
</template>
