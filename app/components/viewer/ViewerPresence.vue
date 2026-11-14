<script setup lang="ts">
// Who else is looking at the drop (usePresence): their faces in the bar, ringed in the color of their cursor. Pressing
// them lists each person and where they are, with the switch that hides everyone's cursors.
import { AvatarStack } from "vite-hub/ui"
import type { PresencePerson } from "~/composables/usePresence"

const props = defineProps<{ people: PresencePerson[]; site: boolean }>()
const showCursors = defineModel<boolean>("showCursors", { required: true })

const label = computed(() => `Who's here: ${props.people.map((person) => person.name).join(", ")}`)

/** Where someone is, for the list: a reviewed site's page, or nothing on a doc, where everyone is on it. */
function whereOf(person: PresencePerson) {
  if (!props.site) return ""
  if (!person.at) return "In Drop"
  try {
    const url = new URL(person.at)
    return url.pathname + url.search
  } catch {
    return person.at
  }
}
</script>

<template>
  <UPopover
    :content="{ align: 'end', side: 'top' }"
    :ui="{ content: 'w-[min(16rem,calc(100vw-1rem))] rounded-[12px]' }"
  >
    <UButton :aria-label="label" class="shrink-0 px-1.5" color="neutral" size="xs" variant="ghost">
      <AvatarStack
        aria-hidden="true"
        :max="3"
        :people="people"
        :style="{ '--vh-avatar-size': '1.25rem' }"
        variant="outline"
      />
    </UButton>
    <template #content>
      <div class="flex flex-col gap-1 p-2">
        <h2 class="px-1.5 pt-1 pb-0.5 text-xs font-medium text-muted">Here now</h2>
        <ul class="flex flex-col">
          <li v-for="person in people" :key="person.id" class="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1">
            <UAvatar
              :alt="person.name"
              class="shrink-0 ring-2"
              size="2xs"
              :src="person.image"
              :style="{ '--tw-ring-color': person.color }"
            />
            <span class="min-w-0 flex-1 truncate text-sm text-highlighted">{{ person.name }}</span>
            <span v-if="whereOf(person)" class="max-w-[45%] shrink-0 truncate text-xs text-muted">{{
              whereOf(person)
            }}</span>
          </li>
        </ul>
        <USeparator class="my-1" />
        <USwitch v-model="showCursors" class="px-1.5 pb-1" label="Show cursors" size="sm" />
      </div>
    </template>
  </UPopover>
</template>
