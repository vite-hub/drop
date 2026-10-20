<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui"

// `compact`: the public pages' header, where the menu is an avatar that opens downward; the dashboard sidebar gets
// shadcn's NavUser row, opening upward.
const { compact = false } = defineProps<{ compact?: boolean }>()

const { signOut } = useUserSession(useNuxtApp().$auth)
// From /api/me, which SSR fetches with the session cookie; the client-side session only exists after hydration.
const { data: me } = useMe()
const shortcutsOpen = useShortcutsOpen()

const items = computed<DropdownMenuItem[][]>(() => [
  [{ type: "label", slot: "account" as const }],
  [{ label: "Theme", slot: "theme" as const, onSelect: (event: Event) => event.preventDefault() }],
  [
    {
      label: "Keyboard shortcuts",
      icon: "i-mingcute-keyboard-line",
      kbds: ["?"],
      onSelect: () => (shortcutsOpen.value = true),
    },
  ],
  [{ label: "Sign out", icon: "i-mingcute-exit-line", onSelect: () => void leave() }],
])
async function leave() {
  await signOut()
  // Leave first: cleared data would flash the dashboard's empty defaults for a frame. /home, not /: / sends whoever
  // it still thinks is signed in to their drops.
  await navigateTo("/home")
  clearNuxtData()
}
const roleLabel = computed(() => ({ admin: "Admin", editor: "Editor", member: "Member" })[me.value?.role ?? "member"])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="
      compact ? { side: 'bottom', align: 'end', sideOffset: 6 } : { side: 'top', align: 'start', sideOffset: 6 }
    "
    :ui="{ content: compact ? 'w-60' : 'w-(--reka-dropdown-menu-trigger-width) min-w-52' }"
  >
    <!-- One trigger element either way: the dropdown's slot hydrates a single node. Compact is just the avatar;
         otherwise shadcn's NavUser, a large sidebar button with the avatar, name and role. -->
    <button
      class="flex cursor-pointer items-center rounded-md transition-colors hover:bg-elevated data-[state=open]:bg-elevated"
      :class="compact ? 'size-8 justify-center' : 'h-12 w-full gap-2 px-2 text-left'"
      type="button"
      aria-label="Account menu"
    >
      <UAvatar
        :alt="me?.name ?? 'You'"
        :class="compact ? 'rounded-md' : 'rounded-lg'"
        :src="me?.image ?? undefined"
        :size="compact ? 'xs' : 'md'"
      />
      <template v-if="!compact">
        <span class="min-w-0 flex-1 leading-tight">
          <span class="block truncate text-sm font-medium text-highlighted">{{ me?.name ?? "You" }}</span>
          <span class="block truncate text-xs text-muted">{{ roleLabel }}</span>
        </span>
        <UIcon name="i-mingcute-selector-vertical-line" class="size-4 shrink-0 text-dimmed" />
      </template>
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
