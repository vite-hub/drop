<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui"
import type { Member } from "#shared/types"
import { DEFAULT_ROLE, ROLE_LABELS, ROLE_SUMMARY, ROLES, type Role } from "#shared/roles"

definePageMeta({ layout: "dashboard", middleware: "auth" })
useSeoMeta({ title: "Members" })

// Anyone can sign in with GitHub and joins as Member; admins promote people from here.
const { data: me } = useMe()
const { members, status, setRole, ban, unban, remove } = useMembers()
const admin = computed(() => me.value?.role === "admin")
const search = ref("")

const description = computed(() => {
  const total = members.value.length || me.value?.members || 1
  return total > 1
    ? `${total} people. Anyone can sign in with GitHub and joins as ${ROLE_LABELS[DEFAULT_ROLE]}; their drops stay private to them.`
    : `Just you so far. Anyone can sign in with GitHub and joins as ${ROLE_LABELS[DEFAULT_ROLE]}.`
})

const rows = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return members.value
    .filter(member => `${member.name} ${member.email}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.you) - Number(a.you) || ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.name.localeCompare(b.name))
})

const roleItems = ROLES.map(value => ({ label: ROLE_LABELS[value], value }))
const statusOf = (member: Member) => (member.banned ? "Banned" : "Active")

function menu(member: Member): DropdownMenuItem[][] {
  return [[
    member.banned
      ? { label: "Unban", icon: "i-lucide-rotate-ccw", onSelect: () => unban(member) }
      : { label: "Ban", icon: "i-lucide-ban", color: "error", onSelect: () => ban(member) },
    { label: "Remove", icon: "i-lucide-trash-2", color: "error", onSelect: () => remove(member) },
  ]]
}

</script>

<template>
  <PageShell id="members" title="Members" :description="description">
    <div class="mb-6 grid grid-cols-1 divide-y divide-default rounded-lg border border-default sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      <div v-for="role in ROLES" :key="role" class="px-4 py-3">
        <p class="flex items-center gap-2 text-sm font-medium text-highlighted">
          {{ ROLE_LABELS[role] }}
          <span v-if="role === DEFAULT_ROLE" class="label-mono text-[10px]">Default</span>
        </p>
        <p class="mt-0.5 text-xs text-muted">{{ ROLE_SUMMARY[role] }}</p>
      </div>
    </div>

    <UInput v-if="members.length > 8" v-model="search" class="mb-3 w-full max-w-xs" icon="i-lucide-search" placeholder="Search members" size="sm" />

    <div class="overflow-hidden rounded-lg border border-default">
      <table class="w-full table-fixed text-sm">
        <thead>
          <tr class="border-b border-default text-left text-xs text-muted">
            <th class="px-4 py-2.5 font-medium">Member</th>
            <th class="w-28 px-2 py-2.5 font-medium sm:w-36 sm:px-4">Role</th>
            <th class="hidden w-20 px-4 py-2.5 text-right font-medium md:table-cell">Drops</th>
            <th class="hidden w-24 px-4 py-2.5 font-medium sm:table-cell">Status</th>
            <th v-if="admin" class="w-11" />
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <tr v-if="status === 'pending' && !members.length">
            <td class="p-4" :colspan="5"><USkeleton class="h-9 w-full" /></td>
          </tr>
          <tr v-for="member in rows" :key="member.id" :class="member.banned && 'text-muted'">
            <td class="px-4 py-3">
              <div class="flex min-w-0 items-center gap-3">
                <UAvatar :alt="member.name" :src="member.image ?? undefined" size="sm" />
                <div class="min-w-0">
                  <p class="truncate font-medium" :class="member.banned ? 'text-muted' : 'text-highlighted'">
                    {{ member.name }}<span v-if="member.you" class="ml-1.5 font-normal text-muted">(you)</span>
                  </p>
                  <p class="truncate font-mono text-xs text-muted">
                    {{ member.email }}<template v-if="member.lastActiveAt && !member.you"> · <TimeAgo :at="member.lastActiveAt" /></template>
                  </p>
                  <p class="mt-1 sm:hidden">
                    <UBadge :color="member.banned ? 'error' : 'neutral'" :label="statusOf(member)" size="sm" :variant="member.banned ? 'subtle' : 'outline'" />
                  </p>
                </div>
              </div>
            </td>
            <td class="px-2 py-3 sm:px-4">
              <USelect
                v-if="admin && !member.you"
                :aria-label="`Role for ${member.name}`"
                class="w-full"
                color="neutral"
                :items="roleItems"
                :model-value="member.role"
                size="sm"
                @update:model-value="value => setRole(member, value as Role)"
              />
              <span v-else class="px-2.5">{{ ROLE_LABELS[member.role] }}</span>
            </td>
            <td class="hidden px-4 py-3 text-right font-mono text-xs md:table-cell">{{ member.drops }}</td>
            <td class="hidden px-4 py-3 sm:table-cell">
              <UBadge :color="member.banned ? 'error' : 'neutral'" :label="statusOf(member)" size="sm" :variant="member.banned ? 'subtle' : 'outline'" />
            </td>
            <td v-if="admin" class="py-3 pr-2">
              <UDropdownMenu v-if="!member.you" :items="menu(member)" :content="{ align: 'end' }">
                <UButton :aria-label="`Actions for ${member.name}`" color="neutral" icon="i-lucide-ellipsis" size="sm" variant="ghost" />
              </UDropdownMenu>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="!admin && me" class="mt-3 text-xs text-muted">Only admins can change roles.</p>


  </PageShell>
</template>
