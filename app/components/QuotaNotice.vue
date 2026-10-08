<script setup lang="ts">
import type { QuotaFailure } from "#shared/quotas"

const notice = useState<QuotaFailure | null>("quota-notice", () => null)
const open = computed({ get: () => Boolean(notice.value), set: value => { if (!value) notice.value = null } })
</script>

<template>
  <UModal v-model:open="open" title="Plan limit reached" :description="notice?.message">
    <template #footer>
      <div v-if="notice" class="flex flex-wrap gap-2">
        <UButton color="neutral" label="Upgrade" :to="notice.upgradeUrl" variant="outline" @click="open = false" />
        <UButton color="neutral" label="Deploy your own" :to="notice.selfHostUrl" variant="outline" @click="open = false" />
      </div>
    </template>
  </UModal>
</template>
