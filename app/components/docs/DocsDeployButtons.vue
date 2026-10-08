<script setup lang="ts">
import type { HostId } from "~/utils/docs"

const props = defineProps<{ host?: HostId }>()
const hosts = computed(() => props.host ? [hostById(props.host)] : HOSTS)
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <UButton
      v-for="item in hosts"
      :key="item.id"
      :to="DEPLOY_URLS[item.id]"
      :icon="item.icon"
      color="neutral"
      variant="outline"
      :label="item.id === 'vps' ? 'Run on a VPS' : `Deploy to ${item.name}`"
    />
  </div>
</template>
