<script setup lang="ts">
import { onMounted, ref } from "vue"
import DropMark from "../../../../app/components/DropMark.vue"
import AccountLink from "../../components/AccountLink.vue"
import DropAddress from "../../components/DropAddress.vue"
import HandChoice from "../../components/HandChoice.vue"
import { shortcut, useBackground } from "../../lib/page"

const { state, error, busy, act } = useBackground()
const step = ref(1)
const steps = ["What Drop does", "Where is your Drop", "Connect", "Where the hand shows", "Try it"]

onMounted(() => act("state.get", {}))

const done = () => window.close()

async function saveDrop(drop: string) {
  if (await act("deployment.set", { drop })) step.value = 3
}
</script>

<template>
  <UApp>
    <main class="mx-auto flex max-w-lg flex-col gap-6 p-10">
      <header class="flex items-center gap-2">
        <DropMark class="size-6" />
        <h1 class="text-lg font-semibold">Welcome to Drop</h1>
      </header>

      <ol class="flex gap-3 text-xs text-muted">
        <li v-for="(name, index) in steps" :key="name" :class="{ 'font-medium text-default': index + 1 === step }">
          {{ index + 1 }}. {{ name }}
        </li>
      </ol>

      <section v-if="step === 1" class="flex flex-col gap-4" data-step="what">
        <p class="text-sm">
          Drop puts a review pill on any site: comment on the page, point at an element, and see who else is there. The
          comments go to your Drop, not to the site.
        </p>
        <p class="text-sm text-muted">Nothing runs on a site until you press Drop there.</p>
        <div><UButton label="Next" @click="step = 2" /></div>
      </section>

      <section v-else-if="step === 2" class="flex flex-col gap-4" data-step="where">
        <p class="text-sm">Use drop.vitehub.dev, or the address of your team's own Drop.</p>
        <DropAddress
          :drop="state?.drop"
          :busy="busy === 'deployment.set'"
          :error="error"
          label="Continue"
          @save="saveDrop"
        />
      </section>

      <section v-else-if="step === 3" class="flex flex-col gap-4" data-step="connect">
        <AccountLink :state="state" :busy="busy === 'link.start'" @connect="act('link.start', {})" />
        <p v-if="error" class="text-xs text-error">{{ error }}</p>
        <div class="flex gap-2">
          <UButton
            :label="state?.account ? 'Next' : 'Later'"
            :variant="state?.account ? 'solid' : 'ghost'"
            @click="step = 4"
          />
        </div>
      </section>

      <section v-else-if="step === 4" class="flex flex-col gap-4" data-step="hand">
        <HandChoice :hand="state?.hand" :busy="busy === 'hand.set'" @change="(hand) => act('hand.set', { hand })" />
        <div><UButton label="Next" @click="step = 5" /></div>
      </section>

      <section v-else class="flex flex-col gap-4" data-step="try">
        <p class="text-sm">
          Open any site and press Drop in the toolbar, or {{ shortcut }}. You can also right-click a page and choose
          Comment with Drop.
        </p>
        <div><UButton label="Done" @click="done" /></div>
      </section>
    </main>
  </UApp>
</template>
