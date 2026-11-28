<script setup lang="ts">
import { onMounted } from "vue"
import DropMark from "../../../../app/components/DropMark.vue"
import AccountLink from "../../components/AccountLink.vue"
import DropAddress from "../../components/DropAddress.vue"
import HandChoice from "../../components/HandChoice.vue"
import { useBackground } from "../../lib/page"

const { state, error, busy, act } = useBackground()
onMounted(() => act("state.get", {}))
</script>

<template>
  <UApp>
    <main class="mx-auto flex max-w-lg flex-col gap-8 p-8">
      <header class="flex items-center gap-2">
        <DropMark class="size-6" />
        <h1 class="text-lg font-semibold">Drop settings</h1>
      </header>

      <DropAddress
        :drop="state?.drop"
        :busy="busy === 'deployment.set'"
        :error="busy === undefined ? error : undefined"
        @save="(drop) => act('deployment.set', { drop })"
      />

      <AccountLink
        :state="state"
        unlink
        :busy="busy === 'link.start'"
        @connect="act('link.start', {})"
        @unlink="act('link.remove', {})"
      />

      <HandChoice :hand="state?.hand" :busy="busy === 'hand.set'" @change="(hand) => act('hand.set', { hand })" />

      <section v-if="state?.kept.length" class="flex flex-col gap-2">
        <h2 class="text-sm font-medium">Sites where Drop stays</h2>
        <ul class="flex flex-col gap-1">
          <li v-for="origin in state.kept" :key="origin" class="flex items-center justify-between gap-2">
            <span class="truncate font-mono text-xs">{{ origin }}</span>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              label="Remove"
              @click="act('site.keep', { origin, keep: false })"
            />
          </li>
        </ul>
      </section>
    </main>
  </UApp>
</template>
