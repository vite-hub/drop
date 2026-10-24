<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui"
import type { Member } from "#shared/types"
import { DEFAULT_ROLE, ROLE_LABELS, ROLE_SUMMARY, ROLES } from "#shared/roles"
import { TIERS, type Tier } from "#shared/quotas"

useSeoMeta({ title: "Members" })

// The admins' page: members don't see it in the sidebar, and find teammates through "@" in the editor instead.
// Anyone who signs in joins as a Member; DROP_ADMINS names the admins by email, so nobody changes roles here.
const { data: me } = await useMe()
if (me.value?.role !== "admin") await navigateTo("/drops", { replace: true })
const { members, status, error, refresh, ban, unban, remove, setPlan } = useMembers()
const search = ref("")
const host = useRequestURL().host

// The heading carries the count, so the description says what it means.
const total = computed(() => members.value.length || me.value?.members || 1)
const description = computed(() => {
  return total.value > 1
    ? `Everyone who signs in joins as ${ROLE_LABELS[DEFAULT_ROLE]}; ${me.value?.mode === "team" ? "what they drop is the team's unless they keep it to themselves" : "their drops stay private to them"}.`
    : // There's no invite flow: say how a teammate gets in, since that's the first thing a new owner looks for here.
      `Just you so far. To bring your team in, send them ${host}: everyone who signs in joins as ${ROLE_LABELS[DEFAULT_ROLE]}.`
})
const counts = computed(() =>
  Object.fromEntries(ROLES.map((role) => [role, members.value.filter((member) => member.role === role).length])),
)

const rows = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return members.value
    .filter((member) => `${member.name} ${member.email ?? ""}`.toLowerCase().includes(needle))
    .sort(
      (a, b) =>
        Number(b.you) - Number(a.you) || ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.name.localeCompare(b.name),
    )
})

// Plans show only while this Drop has quotas; then admins move people between Free and Pro.
const plans = computed(() => members.value.some((member) => member.plan))
const columns = computed(() => (plans.value ? 6 : 5))
const tierItems = TIERS.map((value) => ({ label: PLAN_LABELS[value], value }))

function menu(member: Member): DropdownMenuItem[][] {
  return [
    [
      member.banned
        ? { label: "Unban", icon: "i-mingcute-refresh-anticlockwise-1-line", onSelect: () => void unban(member) }
        : { label: "Ban", icon: "i-mingcute-forbid-circle-line", color: "error", onSelect: () => void ban(member) },
      { label: "Remove", icon: "i-mingcute-delete-2-line", color: "error", onSelect: () => void remove(member) },
    ],
  ]
}
</script>

<template>
  <PageShell id="members" title="Members" :count="total" :description="description">
    <template #actions
      ><UButton to="/admin/review" label="Review Shares" color="neutral" size="sm" variant="ghost" /><UButton
        to="/admin/reports"
        label="Reports"
        color="neutral"
        size="sm"
        variant="ghost"
    /></template>
    <div
      class="mb-6 grid grid-cols-1 divide-y divide-default rounded-lg border border-default sm:grid-cols-2 sm:divide-x sm:divide-y-0"
    >
      <div v-for="role in ROLES" :key="role" class="px-4 py-3">
        <p class="flex items-center gap-2 text-sm font-medium text-highlighted">
          {{ ROLE_LABELS[role] }}
          <span v-if="members.length" class="font-mono text-xs font-normal text-muted tabular-nums">{{
            counts[role]
          }}</span>
          <span v-if="role === DEFAULT_ROLE" class="label-mono ml-auto">Default</span>
        </p>
        <p class="mt-0.5 text-xs text-muted">{{ ROLE_SUMMARY[role] }}</p>
        <p v-if="role === 'admin'" class="mt-1 text-xs text-muted">
          Whoever's email is in <code>DROP_ADMINS</code>, set where this Drop is deployed.
        </p>
      </div>
    </div>

    <UInput
      v-if="members.length > 8"
      v-model="search"
      class="mb-3 w-full max-w-xs"
      icon="i-mingcute-search-line"
      placeholder="Search members"
      size="sm"
    />

    <div class="overflow-hidden rounded-lg border border-default">
      <table class="w-full table-fixed text-sm">
        <thead>
          <tr class="border-b border-default text-left text-xs text-muted">
            <th class="px-4 py-2.5 font-medium">Member</th>
            <th class="w-24 px-2 py-2.5 font-medium sm:w-28 sm:px-4">Role</th>
            <th v-if="plans" class="w-24 px-2 py-2.5 font-medium sm:w-28 sm:px-4">Plan</th>
            <th class="hidden w-20 px-4 py-2.5 text-right font-medium md:table-cell">Drops</th>
            <th class="hidden w-32 px-4 py-2.5 font-medium sm:table-cell">Last active</th>
            <th class="w-11" />
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <tr v-if="error && !members.length">
            <td class="px-4 py-6 text-center" :colspan="columns">
              <p class="text-sm text-highlighted">Couldn't load the members.</p>
              <p class="mt-0.5 text-xs text-muted">{{ errorText(error) }}</p>
              <UButton
                class="mt-3"
                color="neutral"
                icon="i-mingcute-refresh-anticlockwise-1-line"
                label="Try again"
                :loading="status === 'pending'"
                size="sm"
                variant="outline"
                @click="() => refresh()"
              />
            </td>
          </tr>
          <template v-else-if="status === 'pending' && !members.length">
            <tr v-for="n in 3" :key="n">
              <td class="px-4 py-3" :colspan="columns">
                <div class="flex items-center gap-3">
                  <USkeleton class="size-8 rounded-full" />
                  <div class="space-y-1.5">
                    <USkeleton class="h-3.5 w-32" />
                    <USkeleton class="h-3 w-48" />
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <tr v-else-if="search && !rows.length">
            <td class="px-4 py-6 text-center text-sm text-muted" :colspan="columns">No one matches “{{ search }}”.</td>
          </tr>
          <tr v-for="member in rows" :key="member.id" :class="member.banned && 'text-muted'">
            <td class="px-4 py-3">
              <div class="flex min-w-0 items-center gap-3">
                <UAvatar :alt="member.name" :src="member.image ?? undefined" size="sm" />
                <div class="min-w-0">
                  <p class="flex min-w-0 items-center gap-1.5">
                    <span class="truncate font-medium" :class="member.banned ? 'text-muted' : 'text-highlighted'">{{
                      member.name
                    }}</span>
                    <span v-if="member.you" class="shrink-0 text-muted">(you)</span>
                    <UBadge
                      v-if="member.banned"
                      class="shrink-0"
                      color="error"
                      label="Banned"
                      size="sm"
                      variant="subtle"
                    />
                  </p>
                  <p class="truncate font-mono text-xs text-muted">{{ member.email }}</p>
                </div>
              </div>
            </td>
            <td class="px-2 py-3 sm:px-4">
              <UBadge
                v-if="member.role === 'admin'"
                color="neutral"
                :label="ROLE_LABELS.admin"
                size="sm"
                variant="subtle"
              />
              <span v-else class="text-muted">{{ ROLE_LABELS[member.role] }}</span>
            </td>
            <td v-if="plans" class="px-2 py-3 sm:px-4">
              <USelect
                v-if="member.plan !== 'unlimited'"
                :aria-label="`Plan for ${member.name}`"
                class="w-full"
                color="neutral"
                :items="tierItems"
                :model-value="member.plan ?? undefined"
                size="sm"
                variant="ghost"
                @update:model-value="(value) => setPlan(member, value as Tier)"
              />
              <span v-else-if="member.plan">{{ PLAN_LABELS[member.plan] }}</span>
            </td>
            <td class="hidden px-4 py-3 text-right font-mono text-xs tabular-nums md:table-cell">{{ member.drops }}</td>
            <td class="hidden px-4 py-3 text-xs text-muted sm:table-cell">
              <template v-if="member.you">Now</template>
              <TimeAgo v-else-if="member.lastActiveAt" :at="member.lastActiveAt" />
              <template v-else>Never</template>
            </td>
            <td class="py-3 pr-2">
              <UDropdownMenu v-if="!member.you" :items="menu(member)" :content="{ align: 'end' }">
                <UButton
                  :aria-label="`Actions for ${member.name}`"
                  color="neutral"
                  icon="i-mingcute-more-1-fill"
                  size="sm"
                  variant="ghost"
                />
              </UDropdownMenu>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </PageShell>
</template>
