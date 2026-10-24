<script setup lang="ts">
// Details in sections, not a label/value table: the drop itself first (its name, type and size, who dropped it, when,
// where), then who can open it, how many have, its links and how long it lives. Each section's action sits in it. Versions have their own tab (ViewerHistory). A folder leads with
// what goes in it, for the people filing into it and their agents (list_folders); whoever may change the folder edits
// it in place.
import { expiryLabel } from "#shared/expiry"
import { resourceLabel } from "#shared/resources"
import { SHARE_HINTS, SHARE_ICONS } from "#shared/share"
import type { DropDetail } from "#shared/types"

const props = defineProps<{ drop: DropDetail }>()
const emit = defineEmits<{ share: [] }>()
const { data: me } = useMe()
const now = useRelativeNow()
// A site review holds no file of its own ("0 B"), and a folder's name is already its title: neither gets a File row.
const site = computed(() => props.drop.kind === "site")
const type = computed(() =>
  [
    props.drop.teamFolder ? "Team folder" : KIND_LABELS[props.drop.kind],
    ...(props.drop.kind === "app" ? [`${props.drop.paths?.length ?? 0} files`] : []),
    ...(site.value
      ? []
      : [props.drop.kind === "folder" ? itemCount(props.drop.items ?? 0) : formatBytes(props.drop.size)]),
  ].join(" · "),
)
// The state's own name, as on rows and in the share dialog: "Team", "Public link · 5d left".
const access = computed(
  () =>
    `${shareStatus(props.drop, now.value)}${props.drop.sharedFrom ? `, through ${props.drop.sharedFrom.title}` : ""}`,
)
const accessHint = computed(() => SHARE_HINTS[props.drop.share])
// A site goes by its address, a folder by its title, anything else by its file's name.
const name = computed(() =>
  site.value && props.drop.siteUrl
    ? props.drop.siteUrl
    : props.drop.kind === "folder"
      ? props.drop.title
      : props.drop.filename,
)
const folder = computed(() => props.drop.ancestors.map((crumb) => crumb.title).join(" / "))
// The owner's view count, then who the views came from, with the icons agents and people get on rows (AgentIcon).
// Hovering a number says what it counts, as server/utils/views.ts counts it.
const views = computed(() => {
  const counts = props.drop.views
  if (!counts) return null
  const total = counts.person + counts.anonymous + counts.agent
  return {
    total,
    tip: `${total} ${total === 1 ? "view" : "views"}: each viewer counts once a day, the owner's own visits don't`,
    by: [
      {
        label: "signed in",
        icon: "i-mingcute-user-3-line",
        n: counts.person,
        tip: `${counts.person} by people signed in`,
      },
      {
        label: "anonymous",
        icon: "i-mingcute-incognito-mode-line",
        n: counts.anonymous,
        tip: `${counts.anonymous} by visitors not signed in`,
      },
      {
        label: "agents",
        icon: "i-mingcute-sparkles-line",
        n: counts.agent,
        tip: `${counts.agent} by agents reading it, yours included`,
      },
    ],
  }
})

const { describe } = useDropActions()
const describable = computed(() => props.drop.kind === "folder" && props.drop.isOwner && !props.drop.trashedAt)
const editing = ref(false)
const draft = ref("")
const saving = ref(false)
function startEditing() {
  draft.value = props.drop.note ?? ""
  editing.value = true
}
async function save() {
  saving.value = true
  if (await describe(props.drop, draft.value)) editing.value = false
  saving.value = false
}
</script>

<template>
  <div class="divide-y divide-default">
    <section aria-label="File" class="space-y-3 p-4">
      <div class="flex items-center gap-3">
        <span
          class="grid size-10 shrink-0 place-items-center rounded-lg bg-elevated text-muted ring-1 ring-default ring-inset"
        >
          <UIcon :name="drop.teamFolder ? 'i-mingcute-group-2-line' : KIND_ICONS[drop.kind]" class="size-5" />
        </span>
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-highlighted" :title="name">{{ name }}</p>
          <p class="truncate text-xs text-muted tabular-nums">{{ type }}</p>
        </div>
      </div>
      <!-- Icons stand in for the labels; the words still say what each line is. -->
      <ul class="space-y-1.5 text-sm">
        <li class="flex min-w-0 items-center gap-2">
          <AgentIcon class="size-4 shrink-0 text-muted" :kind="drop.actorKind" :name="drop.actorName" />
          <span class="truncate text-highlighted">{{ drop.actorName }}</span>
          <span class="shrink-0 text-muted">via {{ VIA_LABELS[drop.actorKind] }}</span>
        </li>
        <li class="flex items-center gap-2 text-muted">
          <UIcon name="i-mingcute-time-line" class="size-4 shrink-0" />
          <span>Updated <TimeAgo class="text-highlighted" :at="drop.updatedAt" /></span>
        </li>
        <li v-if="folder" class="flex min-w-0 items-center gap-2 text-muted">
          <UIcon name="i-mingcute-folder-line" class="size-4 shrink-0" />
          <span class="truncate" :title="folder"
            >In <span class="text-highlighted">{{ folder }}</span></span
          >
        </li>
      </ul>
    </section>

    <section v-if="drop.kind === 'folder' && (drop.note || describable)" aria-label="Description" class="p-4 text-sm">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-xs font-medium text-muted">Description</h3>
        <UButton
          v-if="describable && !editing"
          class="-my-1"
          color="neutral"
          :label="drop.note ? 'Edit' : 'Add'"
          size="xs"
          variant="ghost"
          @click="startEditing"
        />
      </div>
      <form v-if="editing" class="mt-2 space-y-2" @submit.prevent="save">
        <UTextarea
          v-model="draft"
          aria-label="Description"
          autofocus
          autoresize
          class="w-full"
          :maxlength="2000"
          :maxrows="16"
          placeholder="What belongs here, and how to name and write it."
          :rows="4"
        />
        <div class="flex justify-end gap-2">
          <UButton color="neutral" label="Cancel" size="sm" variant="ghost" @click="editing = false" />
          <UButton color="neutral" label="Save" :loading="saving" size="sm" type="submit" />
        </div>
      </form>
      <p v-else-if="drop.note" class="mt-1.5 whitespace-pre-line text-pretty text-highlighted">{{ drop.note }}</p>
      <p v-else class="mt-1.5 text-pretty text-muted">
        What belongs here and how to name it. Agents read this before they publish into the folder.
      </p>
    </section>

    <section v-if="drop.isOwner" aria-labelledby="details-access" class="space-y-2.5 p-4">
      <h3 id="details-access" class="text-xs font-medium text-muted">Access</h3>
      <div class="flex items-start gap-3">
        <span class="grid size-8 shrink-0 place-items-center rounded-md bg-elevated text-muted">
          <UIcon :name="SHARE_ICONS[drop.share]" class="size-4" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm text-highlighted">{{ access }}</p>
          <p class="text-xs text-pretty text-muted">{{ accessHint }}</p>
        </div>
        <UButton color="neutral" label="Change" size="xs" variant="outline" @click="emit('share')" />
      </div>
    </section>

    <section v-if="views" aria-labelledby="details-views" class="@container space-y-2.5 p-4">
      <h3 id="details-views" class="text-xs font-medium text-muted">Views</h3>
      <!-- A total and where the views came from, each a number over what it counts; two by two in a narrow panel.
           Hovering says how they're counted. -->
      <dl class="grid grid-cols-2 gap-x-2 gap-y-3 @[22rem]:grid-cols-4">
        <UTooltip :text="views.tip">
          <div class="flex flex-col-reverse">
            <dt class="text-xs text-muted">Total</dt>
            <dd class="text-lg font-medium text-highlighted tabular-nums">{{ views.total }}</dd>
          </div>
        </UTooltip>
        <UTooltip v-for="part in views.by" :key="part.label" :text="part.tip">
          <div class="flex flex-col-reverse">
            <dt class="flex items-center gap-1 text-xs text-muted">
              <UIcon :name="part.icon" class="size-3.5 shrink-0" />
              <span class="truncate">{{ part.label }}</span>
            </dt>
            <dd class="text-lg font-medium text-highlighted tabular-nums">{{ part.n }}</dd>
          </div>
        </UTooltip>
      </dl>
    </section>

    <section v-if="drop.resources" aria-labelledby="details-links" class="space-y-2 p-4">
      <h3 id="details-links" class="text-xs font-medium text-muted">Links</h3>
      <ul class="space-y-1.5 text-sm">
        <li v-for="resource in drop.resources" :key="resource.url">
          <a
            class="flex min-w-0 items-center gap-2 text-highlighted hover:underline"
            :href="resource.url"
            rel="noopener noreferrer"
            target="_blank"
            :title="resource.url"
          >
            <ViewerResourceIcon :url="resource.url" />
            <span class="truncate">{{ resourceLabel(resource) }}</span>
          </a>
        </li>
      </ul>
    </section>

    <!-- The team's folders never expire, so there's nothing to choose. -->
    <section v-if="drop.teamFolder" aria-labelledby="details-lifetime" class="space-y-1 p-4 text-sm">
      <h3 id="details-lifetime" class="text-xs font-medium text-muted">Lifetime</h3>
      <p class="text-highlighted">Kept: the team's folders never expire</p>
    </section>
    <!-- A drop in a folder lives as long as the folder at the top, so its lifetime is changed there. -->
    <section
      v-else-if="drop.isOwner && drop.parentId && drop.ancestors.length && me?.expiry.days"
      aria-labelledby="details-lifetime"
      class="space-y-1 p-4 text-sm"
    >
      <h3 id="details-lifetime" class="text-xs font-medium text-muted">Lifetime</h3>
      <p class="text-highlighted tabular-nums">{{ expiryLabel(drop, now) }}, with {{ drop.ancestors[0]!.title }}</p>
    </section>
    <!-- A drop at the top chooses its own lifetime. -->
    <ViewerLifetime v-else-if="drop.isOwner && !drop.parentId" class="p-4" :drop="drop" />

    <section v-if="$slots.actions" class="p-2">
      <slot name="actions" />
    </section>
  </div>
</template>
