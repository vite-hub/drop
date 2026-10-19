<script setup lang="ts">
// Details as label/value rows, like an inspector: who dropped it, what it is, who can see it, how long it lives.
// Each row's action sits at its end. Versions have their own tab (ViewerHistory). A folder leads with what goes in it,
// for the people filing into it and their agents (list_folders); whoever may change the folder edits it in place.
import { expiryLabel } from "#shared/expiry"
import { SHARE_ICONS } from "#shared/share"
import type { DropDetail } from "#shared/types"

const props = defineProps<{ drop: DropDetail }>()
const emit = defineEmits<{ share: [] }>()
const { data: me } = useMe()
const now = useRelativeNow()
// A site review holds no file of its own ("0 B"), and a folder's name is already its title: neither gets a File row.
const site = computed(() => props.drop.kind === "site")
const type = computed(() => [
  props.drop.teamFolder ? "Team folder" : KIND_LABELS[props.drop.kind],
  ...(props.drop.kind === "app" ? [`${props.drop.paths?.length ?? 0} files`] : []),
  ...(site.value ? [] : [props.drop.kind === "folder" ? itemCount(props.drop.items ?? 0) : formatBytes(props.drop.size)]),
].join(" · "))
// The state's own name, as on rows and in the share dialog: "Team", "Public link · 5d left".
const access = computed(() => `${shareStatus(props.drop, now.value)}${props.drop.sharedFrom ? `, through ${props.drop.sharedFrom.title}` : ""}`)
const folder = computed(() => props.drop.ancestors.map(crumb => crumb.title).join(" / "))

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
  <div class="space-y-6 p-4">
    <section v-if="drop.kind === 'folder' && (drop.note || describable)" aria-label="Description" class="text-sm">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-muted">Description</h3>
        <UButton v-if="describable && !editing" class="-my-1" color="neutral" :label="drop.note ? 'Edit' : 'Add'" size="xs" variant="ghost" @click="startEditing" />
      </div>
      <form v-if="editing" class="mt-2 space-y-2" @submit.prevent="save">
        <UTextarea v-model="draft" aria-label="Description" autofocus autoresize class="w-full" :maxlength="2000" :maxrows="16" placeholder="What belongs here, and how to name and write it." :rows="4" />
        <div class="flex justify-end gap-2">
          <UButton color="neutral" label="Cancel" size="sm" variant="ghost" @click="editing = false" />
          <UButton color="neutral" label="Save" :loading="saving" size="sm" type="submit" />
        </div>
      </form>
      <p v-else-if="drop.note" class="mt-1.5 whitespace-pre-line text-highlighted">{{ drop.note }}</p>
      <p v-else class="mt-1.5 text-muted">What belongs here and how to name it. Agents read this before they publish into the folder.</p>
    </section>

    <dl class="space-y-2.5 text-sm">
      <div class="flex items-center gap-3">
        <dt class="w-20 shrink-0 text-muted">Dropped by</dt>
        <dd class="flex min-w-0 items-center gap-1.5">
          <AgentIcon class="size-3.5 shrink-0 text-muted" :kind="drop.actorKind" :name="drop.actorName" />
          <span class="truncate text-highlighted">{{ drop.actorName }}</span>
          <span class="shrink-0 text-muted">via {{ VIA_LABELS[drop.actorKind] }}</span>
        </dd>
      </div>
      <div class="flex items-center gap-3">
        <dt class="w-20 shrink-0 text-muted">Updated</dt>
        <dd class="text-highlighted"><TimeAgo :at="drop.updatedAt" /></dd>
      </div>
      <div v-if="site && drop.siteUrl" class="flex items-center gap-3">
        <dt class="w-20 shrink-0 text-muted">Address</dt>
        <dd class="min-w-0 truncate font-mono text-xs text-highlighted" :title="drop.siteUrl">{{ drop.siteUrl }}</dd>
      </div>
      <div v-else-if="drop.kind !== 'folder'" class="flex items-center gap-3">
        <dt class="w-20 shrink-0 text-muted">File</dt>
        <dd class="min-w-0 truncate font-mono text-xs text-highlighted">{{ drop.filename }}</dd>
      </div>
      <div class="flex items-center gap-3">
        <dt class="w-20 shrink-0 text-muted">Type</dt>
        <dd class="text-highlighted tabular-nums">{{ type }}</dd>
      </div>
      <div v-if="folder" class="flex items-center gap-3">
        <dt class="w-20 shrink-0 text-muted">Folder</dt>
        <dd class="min-w-0 truncate text-highlighted" :title="folder">{{ folder }}</dd>
      </div>
      <div v-if="drop.isOwner" class="flex items-center gap-3">
        <dt class="w-20 shrink-0 text-muted">Access</dt>
        <dd class="flex min-w-0 flex-1 items-center gap-1.5 text-highlighted">
          <UIcon :name="SHARE_ICONS[drop.share]" class="size-3.5 shrink-0 text-muted" />
          <span class="truncate">{{ access }}</span>
        </dd>
        <UButton class="-my-1" color="neutral" label="Change" size="xs" variant="ghost" @click="emit('share')" />
      </div>
    </dl>

    <!-- A drop in a folder lives as long as the folder at the top, so its lifetime is changed there. -->
    <!-- The team's folders never expire, so there's nothing to choose. -->
    <dl v-if="drop.teamFolder" class="text-sm">
      <div class="flex items-center gap-3">
        <dt class="w-20 shrink-0 text-muted">Lifetime</dt>
        <dd class="min-w-0 truncate text-highlighted">Kept: the team's folders never expire</dd>
      </div>
    </dl>
    <ViewerLifetime v-else-if="drop.isOwner && !drop.parentId" :drop="drop" />
    <dl v-else-if="drop.isOwner && drop.ancestors.length && me?.expiry.days" class="text-sm">
      <div class="flex items-center gap-3">
        <dt class="w-20 shrink-0 text-muted">Lifetime</dt>
        <dd class="min-w-0 truncate text-highlighted tabular-nums">{{ expiryLabel(drop, now) }}, with {{ drop.ancestors[0]!.title }}</dd>
      </div>
    </dl>

    <section v-if="$slots.actions" class="-mx-2 border-t border-default pt-3">
      <slot name="actions" />
    </section>
  </div>
</template>
