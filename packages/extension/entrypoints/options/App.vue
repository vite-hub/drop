<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { browser } from "wxt/browser"
import DropMark from "../../../../app/components/DropMark.vue"
import AccountLink from "../../components/AccountLink.vue"
import DropAddress, { type DropChoice } from "../../components/DropAddress.vue"
import HandChoice from "../../components/HandChoice.vue"
import KeptSites from "../../components/KeptSites.vue"
import type { Hand } from "../../lib/messages"
import { DEFAULT_DROP, isBeta, releaseOrigin, setHand, useBackground } from "../../lib/page"

const { state, error, busy, act } = useBackground()
const choice = ref<DropChoice>()
const hand = ref<Hand>("press")
const handDenied = ref(false)
const version = browser.runtime.getManifest().version

onMounted(() => act("state.get", {}))

watch(
  () => state.value?.hand,
  (current) => {
    if (current) hand.value = current
  },
)
watch(hand, (next) => {
  if (next === "everywhere") handDenied.value = false
})

const moved = computed(() => !!choice.value && !!state.value && choice.value.drop !== state.value.drop)

function useDrop() {
  const drop = choice.value?.drop
  if (!drop) return
  return drop === DEFAULT_DROP ? act("deployment.reset", {}) : act("deployment.set", { drop })
}

async function saveHand() {
  handDenied.value = false
  if ((await setHand(hand.value, state.value?.hand, act)) !== "denied") return
  handDenied.value = true
  hand.value = "press"
}

async function removeSite(origin: string) {
  if (await act("site.keep", { origin, keep: false })) await releaseOrigin(origin, state.value)
}
</script>

<template>
  <UApp>
    <main class="mx-auto flex max-w-xl flex-col gap-10 px-6 py-12 text-base">
      <header class="flex items-center gap-2 text-highlighted">
        <DropMark class="h-4 w-7" />
        <h1 class="font-semibold">Drop settings</h1>
      </header>

      <section class="flex flex-col gap-4" aria-labelledby="drop-heading">
        <h2 id="drop-heading" class="text-lg font-semibold text-highlighted">Your Drop</h2>
        <DropAddress v-model:choice="choice" :state="state" />
        <div v-if="moved" class="flex items-center gap-3 rounded-lg bg-elevated p-4 text-sm">
          <span class="flex-1">Changing your Drop disconnects this browser. Connect again afterwards.</span>
          <UButton
            color="neutral"
            label="Use this Drop"
            :loading="busy === 'deployment.set' || busy === 'deployment.reset'"
            @click="useDrop"
          />
        </div>
      </section>

      <section class="flex flex-col gap-4" aria-labelledby="account-heading">
        <h2 id="account-heading" class="text-lg font-semibold text-highlighted">Account</h2>
        <AccountLink
          :state="state"
          unlink
          :busy="busy === 'link.remove'"
          @state="(next) => (state = next)"
          @unlink="act('link.remove', {})"
        />
      </section>

      <section class="flex flex-col gap-4" aria-labelledby="hand-heading">
        <h2 id="hand-heading" class="text-lg font-semibold text-highlighted">Where the hand shows</h2>
        <HandChoice v-model:choice="hand" :current="state?.hand" :denied="handDenied" />
        <div v-if="state && hand !== state.hand">
          <UButton color="neutral" label="Save" :loading="busy === 'hand.set'" @click="saveHand" />
        </div>
      </section>

      <section class="flex flex-col gap-4" aria-labelledby="sites-heading">
        <div class="flex flex-col gap-1">
          <h2 id="sites-heading" class="text-lg font-semibold text-highlighted">Sites where Drop stays</h2>
          <p class="text-sm text-muted">On these sites the hand shows even when you don't press Drop.</p>
        </div>
        <KeptSites :sites="state?.kept ?? []" :busy="busy === 'site.keep'" @remove="removeSite" />
      </section>

      <p v-if="error" class="text-sm text-error" role="alert">{{ error }}</p>

      <footer class="flex flex-col gap-1 border-t border-default pt-6 text-sm text-muted">
        <p v-if="isBeta(version)" data-testid="beta">
          You're on the beta. It updates more often and may break. Install Drop from your browser's store to leave it.
        </p>
        <p class="font-mono text-xs">Drop {{ version }}</p>
      </footer>
    </main>
  </UApp>
</template>
