<script setup lang="ts">
import type { HostId } from "~/utils/docs"

// What a host gives Drop, in one table, and the Drop running there.
const props = defineProps<{ host: HostId }>()
const info = computed(() => hostById(props.host))
const rows = computed(() => [
  ["Database", info.value.database],
  ["Files", info.value.files],
  ["Rate limits", info.value.rateLimits],
  ["Code images", info.value.codeImages],
  ["Code image cleanup", info.value.cleanup],
])
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-default">
    <table class="w-full text-sm">
      <tbody class="divide-y divide-default">
        <tr v-for="[label, value] in rows" :key="label"><td class="w-44 px-3 py-2 text-muted">{{ label }}</td><td class="px-3 py-2 text-highlighted">{{ value }}</td></tr>
        <tr>
          <td class="px-3 py-2 text-muted">Live</td>
          <td class="px-3 py-2">
            <a v-if="info.live" :href="info.live">{{ info.live.replace("https://", "") }}</a>
            <span v-else>Not deployed yet</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
