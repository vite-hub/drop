<script setup lang="ts">
// One team: its folders, its people and the invitations out, and, where teams pay, its plan. The owner and admins
// invite, remove, make folders, and pay; members see who's on it and may leave (server/utils/teams.ts).
import type { DropdownMenuItem } from "@nuxt/ui"

const route = useRoute()
const id = computed(() => String(route.params.id))
const { data: me } = useMe()
const { data: shared } = useSharedWithMe()
const teams = useTeams()
const notify = useNotify()
const confirm = useConfirm()
const newFolder = useFolderDialog()

const team = computed(() => me.value?.teams?.find((item) => item.id === id.value))
const runs = computed(() => team.value?.role === "owner" || team.value?.role === "admin")
// Better Auth's client calls go from the browser, with its session cookie.
const { data: detail, refresh } = useAsyncData(keys.team(id.value), () => teams.full(id.value), {
  default: () => null,
  server: false,
})
useSeoMeta({ title: () => team.value?.name ?? "Team" })

const folders = computed(() => shared.value.filter((drop) => drop.teamFolder && drop.team === id.value))
const members = computed(() =>
  [...(detail.value?.members ?? [])].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.user.name.localeCompare(b.user.name),
  ),
)
const pending = computed(() => (detail.value?.invitations ?? []).filter((item) => item.status === "pending"))
const ROLE_ORDER = ["owner", "admin", "member"]

// Billing: a free team holds up to `freeMembers` people, counting the invitations out.
const billing = computed(() => me.value?.billing)
const seats = computed(() => members.value.length + pending.value.length)
const full = computed(() => Boolean(billing.value && !team.value?.paid && seats.value >= billing.value.freeMembers))

const email = ref("")
const role = ref<"member" | "admin">("member")
const inviting = ref(false)
const roleItems = [
  { label: "Member", value: "member" },
  { label: "Admin", value: "admin" },
]

async function invite() {
  inviting.value = true
  try {
    const sent = await teams.invite(id.value, email.value.trim(), role.value)
    await copy(sent.id, `Invited ${sent.email}. Link copied`)
    email.value = ""
    await refresh()
  } catch (error) {
    notify.fail("Couldn't invite them", error)
  } finally {
    inviting.value = false
  }
}

async function copy(invitationId: string, title = "Link copied") {
  await navigator.clipboard.writeText(inviteLink(invitationId)).catch(() => {})
  notify.done(title)
}

async function act(action: () => Promise<unknown>, failure: string) {
  try {
    await action()
    await refresh()
  } catch (error) {
    notify.fail(failure, error)
  }
}

function menu(person: (typeof members.value)[number]): DropdownMenuItem[][] {
  const other = person.role === "admin" ? "member" : "admin"
  return [
    [
      ...(team.value?.role === "owner" && person.role !== "owner"
        ? [
            {
              label: other === "admin" ? "Make admin" : "Make member",
              icon: "i-mingcute-user-setting-line",
              onSelect: () => void act(() => teams.setRole(id.value, person.id, other), "Couldn't change the role"),
            },
          ]
        : []),
      {
        label: "Remove",
        icon: "i-mingcute-delete-2-line",
        color: "error" as const,
        onSelect: () =>
          void (async () => {
            if (
              await confirm({
                title: `Remove ${person.user.name}?`,
                description: "They lose the team's folders. Their drops in them stay theirs, and stay in the folders.",
                confirmLabel: "Remove",
                destructive: true,
              })
            )
              await act(() => teams.removeMember(id.value, person.id), "Couldn't remove them")
          })(),
      },
    ],
  ]
}

async function leave() {
  if (
    !(await confirm({
      title: `Leave ${team.value?.name}?`,
      description: "You lose its folders. Your drops in them stay yours, and stay in the folders.",
      confirmLabel: "Leave",
      destructive: true,
    }))
  )
    return
  try {
    await teams.leave(id.value)
    await navigateTo("/teams")
  } catch (error) {
    notify.fail("Couldn't leave the team", error)
  }
}

async function makeFolder() {
  const picked = await newFolder({})
  if (!picked) return
  try {
    await teams.addFolder(id.value, { title: picked.title, description: picked.description })
  } catch (error) {
    notify.fail("Couldn't make the folder", error)
  }
}

const paying = ref(false)
async function pay(action: () => Promise<{ url?: string | null }>) {
  paying.value = true
  try {
    const { url } = await action()
    if (url) window.location.href = url
  } catch (error) {
    notify.fail("Couldn't open billing", error)
    paying.value = false
  }
}

if (import.meta.client && route.query.billing === "done") {
  notify.done("You're on the Team plan")
  void refreshNuxtData(keys.me)
}
</script>

<template>
  <PageShell
    :id="`team-${id}`"
    :title="team?.name ?? 'Team'"
    :count="members.length || undefined"
    description="Its folders reach its members and their agents only."
  >
    <template v-if="team" #actions>
      <UButton
        v-if="runs"
        color="neutral"
        icon="i-mingcute-folder-add-line"
        label="New folder"
        size="sm"
        variant="ghost"
        @click="makeFolder"
      />
      <UButton v-if="team.role !== 'owner'" color="neutral" label="Leave" size="sm" variant="ghost" @click="leave" />
    </template>

    <p v-if="!team" class="text-sm text-muted">You're not on this team. <NuxtLink to="/teams">Your teams</NuxtLink></p>
    <div v-else class="space-y-8">
      <section aria-labelledby="team-folders">
        <h2 id="team-folders" class="mb-2 text-sm font-medium text-highlighted">Folders</h2>
        <ul v-if="folders.length" class="divide-y divide-default overflow-hidden rounded-lg border border-default">
          <li v-for="folder in folders" :key="folder.id">
            <NuxtLink
              :to="`/drops/${folder.id}`"
              class="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-elevated/50"
            >
              <UIcon name="i-mingcute-folder-line" class="size-4 text-muted" />
              <span class="min-w-0 flex-1 truncate">{{ folder.title }}</span>
            </NuxtLink>
          </li>
        </ul>
        <p v-else class="text-sm text-muted">No folders yet.</p>
      </section>

      <section aria-labelledby="team-people">
        <h2 id="team-people" class="mb-2 text-sm font-medium text-highlighted">People</h2>
        <form v-if="runs" class="mb-3 flex flex-wrap gap-2" @submit.prevent="invite">
          <UInput
            v-model="email"
            aria-label="Email to invite"
            class="min-w-56 flex-1"
            :disabled="full"
            placeholder="name@example.com"
            type="email"
          />
          <USelect v-model="role" aria-label="Role" class="w-28" :disabled="full" :items="roleItems" />
          <UButton color="neutral" :disabled="full || !email.trim()" label="Invite" :loading="inviting" type="submit" />
        </form>
        <div class="overflow-hidden rounded-lg border border-default">
          <ul class="divide-y divide-default text-sm">
            <li v-for="person in members" :key="person.id" class="flex items-center gap-3 px-4 py-2.5">
              <UAvatar :alt="person.user.name" :src="person.user.image ?? undefined" size="sm" />
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium text-highlighted">
                  {{ person.user.name
                  }}<span v-if="person.userId === me?.id" class="ml-1.5 font-normal text-muted">(you)</span>
                </p>
                <p class="truncate font-mono text-xs text-muted">{{ person.user.email }}</p>
              </div>
              <span class="text-xs text-muted capitalize">{{ person.role }}</span>
              <UDropdownMenu
                v-if="runs && person.role !== 'owner' && person.userId !== me?.id"
                :content="{ align: 'end' }"
                :items="menu(person)"
              >
                <UButton
                  :aria-label="`Actions for ${person.user.name}`"
                  color="neutral"
                  icon="i-mingcute-more-1-fill"
                  size="sm"
                  variant="ghost"
                />
              </UDropdownMenu>
            </li>
            <li v-for="item in pending" :key="item.id" class="flex items-center gap-3 px-4 py-2.5 text-muted">
              <UIcon name="i-mingcute-mail-send-line" class="size-4" />
              <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ item.email }}</span>
              <span class="text-xs">Invited</span>
              <template v-if="runs">
                <UButton color="neutral" label="Copy link" size="sm" variant="ghost" @click="copy(item.id)" />
                <UButton
                  color="neutral"
                  label="Cancel"
                  size="sm"
                  variant="ghost"
                  @click="act(() => teams.cancelInvite(item.id), 'Couldn\'t cancel the invitation')"
                />
              </template>
            </li>
          </ul>
        </div>
      </section>

      <section v-if="billing" aria-labelledby="team-plan">
        <h2 id="team-plan" class="mb-2 text-sm font-medium text-highlighted">Plan</h2>
        <div class="flex flex-wrap items-center gap-3 rounded-lg border border-default px-4 py-3 text-sm">
          <div class="min-w-0 flex-1">
            <p class="font-medium text-highlighted">{{ team.paid ? "Team" : "Free" }}</p>
            <p class="text-xs text-muted">
              <template v-if="team.paid"
                >Billed per member. Everyone on the team gets the Pro plan: any number of drops, more storage, and drops
                kept forever.</template
              >
              <template v-else
                >{{ seats }} of {{ billing.freeMembers }} free members, invitations included. The Team plan adds more
                members and gives each the Pro plan.</template
              >
            </p>
          </div>
          <template v-if="team.role === 'owner' || team.role === 'admin'">
            <UButton
              v-if="team.paid"
              color="neutral"
              label="Manage billing"
              :loading="paying"
              size="sm"
              variant="outline"
              @click="pay(() => teams.manageBilling(id))"
            />
            <template v-else>
              <UButton
                v-if="billing.annual"
                color="neutral"
                label="Pay yearly"
                :loading="paying"
                size="sm"
                variant="ghost"
                @click="pay(() => teams.upgrade(id, true))"
              />
              <UButton
                color="neutral"
                label="Start the Team plan"
                :loading="paying"
                size="sm"
                @click="pay(() => teams.upgrade(id))"
              />
            </template>
          </template>
        </div>
        <p class="mt-2 text-xs text-muted">
          Boards aren't part of the Team plan. <NuxtLink class="underline" to="/pricing">Plans and prices</NuxtLink>
        </p>
      </section>
    </div>
  </PageShell>
</template>
