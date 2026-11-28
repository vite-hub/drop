<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from "vue"
import { browser } from "wxt/browser"
import DropMark from "../../../../app/components/DropMark.vue"
import ConnectProblem from "../../components/ConnectProblem.vue"
import DropAddress, { type DropChoice } from "../../components/DropAddress.vue"
import HandChoice from "../../components/HandChoice.vue"
import PillSketch from "../../components/PillSketch.vue"
import PinSketch from "../../components/PinSketch.vue"
import type { Hand } from "../../lib/messages"
import {
  DEFAULT_DROP,
  hasOrigin,
  hostOf,
  isFirefox,
  setHand,
  shortcutKeys,
  useBackground,
  useConnect,
} from "../../lib/page"

const STEPS = 5
const TRY_URL = "https://example.com/"

const { state, error, busy, act } = useBackground()
const { problem, detail, connecting, connect } = useConnect(state)
const step = ref(1)
const heading = useTemplateRef<HTMLElement>("heading")
const choice = ref<DropChoice>()
const allowed = ref(false)
const hand = ref<Hand>("press")
const handDenied = ref(false)
const keys = ref<string[]>([])
const tried = ref(false)

onMounted(async () => {
  await act("state.get", {})
  hand.value = state.value?.hand ?? "press"
  keys.value = await shortcutKeys()
})

const connected = computed(() => !!state.value?.account)

watch([step, connected], async () => {
  await nextTick()
  heading.value?.focus()
})

watch(
  () => [step.value, state.value?.drop] as const,
  async ([current, drop]) => {
    if (current === 3 && drop) allowed.value = await hasOrigin(drop).catch(() => false)
  },
)

const host = computed(() => hostOf(state.value?.drop ?? DEFAULT_DROP))
const who = computed(() => state.value?.account?.name ?? state.value?.account?.email ?? "Your account")

async function saveDrop() {
  const picked = choice.value
  if (!picked) return
  const same = picked.drop === state.value?.drop
  const saved =
    same || (picked.drop === DEFAULT_DROP ? act("deployment.reset", {}) : act("deployment.set", { drop: picked.drop }))
  if (await saved) step.value = 3
}

async function saveHand() {
  handDenied.value = false
  const outcome = await setHand(hand.value, state.value?.hand, act)
  if (outcome === "saved") step.value = 5
  if (outcome !== "denied") return
  handDenied.value = true
  hand.value = "press"
}

watch(hand, (next) => {
  if (next === "everywhere") handDenied.value = false
})

function tryIt() {
  tried.value = true
  return browser.tabs.create({ url: TRY_URL })
}
</script>

<template>
  <UApp>
    <main class="mx-auto flex min-h-screen max-w-xl flex-col px-6 py-12 text-base">
      <header class="flex items-center gap-2 text-highlighted">
        <DropMark class="h-4 w-7" />
        <span class="font-semibold">Drop</span>
      </header>

      <div class="mt-10 flex gap-1.5" aria-hidden="true">
        <span
          v-for="n in STEPS"
          :key="n"
          class="h-1 flex-1 rounded-full"
          :class="n <= step ? 'bg-inverted' : 'bg-accented'"
        />
      </div>
      <p class="mt-3 font-mono text-xs text-muted" data-testid="step">Step {{ step }} of {{ STEPS }}</p>

      <section v-if="step === 1" class="mt-2 flex flex-col gap-6" data-step="what">
        <h1 ref="heading" tabindex="-1" class="text-2xl font-semibold text-highlighted outline-none">
          Comment on any website
        </h1>
        <ul class="flex flex-col gap-3 text-default">
          <li class="flex gap-3">
            <UIcon name="i-mingcute-chat-1-line" class="mt-0.5 size-5 shrink-0 text-muted" />
            <span>Click anything on a page and write a note about it.</span>
          </li>
          <li class="flex gap-3">
            <UIcon name="i-mingcute-ruler-line" class="mt-0.5 size-5 shrink-0 text-muted" />
            <span>Measure sizes and gaps, or draw on the page with a marker.</span>
          </li>
          <li class="flex gap-3">
            <UIcon name="i-mingcute-folder-line" class="mt-0.5 size-5 shrink-0 text-muted" />
            <span>Your notes are saved in your Drop, so you can find and share them later.</span>
          </li>
        </ul>
        <PillSketch />
      </section>

      <section v-else-if="step === 2" class="mt-2 flex flex-col gap-6" data-step="where">
        <div class="flex flex-col gap-2">
          <h1 ref="heading" tabindex="-1" class="text-2xl font-semibold text-highlighted outline-none">
            Where is your Drop?
          </h1>
          <p class="text-muted">Drop keeps your notes. Pick the one you sign in to.</p>
        </div>
        <DropAddress v-model:choice="choice" :state="state" />
        <p v-if="error" class="text-sm text-error" role="alert">{{ error }}</p>
      </section>

      <section v-else-if="step === 3 && connected" class="mt-2 flex flex-col gap-6" data-step="connected">
        <div class="flex flex-col gap-2">
          <h1 ref="heading" tabindex="-1" class="text-2xl font-semibold text-highlighted outline-none">
            You're connected
          </h1>
          <p class="text-muted">Notes you write in this browser go to your Drop.</p>
        </div>
        <div class="flex items-center gap-3 rounded-lg border border-default p-4">
          <UAvatar :alt="who" size="lg" />
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium text-highlighted" data-testid="account">Connected as {{ who }}</p>
            <p class="truncate text-sm text-muted">
              <template v-if="state?.account?.email && state.account.name">{{ state.account.email }} · </template>
              <span class="font-mono">{{ host }}</span>
            </p>
          </div>
          <UIcon name="i-mingcute-check-circle-line" class="size-5 shrink-0 text-success" />
        </div>
      </section>

      <section v-else-if="step === 3" class="mt-2 flex flex-col gap-6" data-step="connect">
        <div class="flex flex-col gap-2">
          <h1 ref="heading" tabindex="-1" class="text-2xl font-semibold text-highlighted outline-none">
            Connect to your Drop
          </h1>
          <p class="text-muted">
            So your notes land in your account. {{ allowed ? "One window comes next." : "Two windows come next." }}
          </p>
        </div>
        <ol class="flex flex-col gap-4">
          <li v-if="!allowed" class="flex gap-3">
            <span class="grid size-6 shrink-0 place-items-center rounded-full bg-elevated font-mono text-xs">1</span>
            <div>
              <p class="font-medium text-highlighted">Your browser asks first</p>
              <p class="text-sm text-muted">
                It asks to let Drop talk to <span class="font-mono">{{ host }}</span>. Choose Allow.
              </p>
            </div>
          </li>
          <li class="flex gap-3">
            <span class="grid size-6 shrink-0 place-items-center rounded-full bg-elevated font-mono text-xs">{{
              allowed ? 1 : 2
            }}</span>
            <div>
              <p class="font-medium text-highlighted">{{ allowed ? "Your Drop asks" : "Then your Drop asks" }}</p>
              <p class="text-sm text-muted">
                A small Drop window asks if this browser may save notes to your account.
                {{ allowed ? "Choose Allow." : "Choose Allow again." }}
              </p>
            </div>
          </li>
        </ol>
        <p class="rounded-lg bg-elevated p-4 text-sm text-muted">
          You can disconnect this browser from your Drop at any time. If you skip this, Measure and Marker still work,
          and Comment asks you to connect.
        </p>
        <ConnectProblem :problem="problem" :detail="detail" :host="host" />
      </section>

      <section v-else-if="step === 4" class="mt-2 flex flex-col gap-6" data-step="hand">
        <div class="flex flex-col gap-2">
          <h1 ref="heading" tabindex="-1" class="text-2xl font-semibold text-highlighted outline-none">
            Where should the hand show?
          </h1>
          <p class="text-muted">
            The hand <DropMark class="inline h-3 w-5 align-baseline text-highlighted" /> opens Drop's tools on a page.
          </p>
        </div>
        <HandChoice v-model:choice="hand" :current="state?.hand" :denied="handDenied" />
        <p v-if="error" class="text-sm text-error" role="alert">{{ error }}</p>
      </section>

      <section v-else class="mt-2 flex flex-col gap-6" data-step="try">
        <div class="flex flex-col gap-2">
          <h1 ref="heading" tabindex="-1" class="text-2xl font-semibold text-highlighted outline-none">Try it</h1>
          <p class="text-muted">Keep Drop one click away.</p>
        </div>
        <template v-if="isFirefox">
          <p>
            Drop's button is in the toolbar, next to the address bar. Press it on any page to open Drop there. To move
            it, right-click the toolbar and choose Customize Toolbar.
          </p>
        </template>
        <template v-else>
          <PinSketch />
          <ol class="flex flex-col gap-2">
            <li class="flex items-center gap-3">
              <span class="grid size-6 shrink-0 place-items-center rounded-full bg-elevated font-mono text-xs">1</span>
              <span
                >Click the puzzle piece
                <UIcon name="i-mingcute-plugin-2-line" class="inline size-4 align-text-bottom" /> next to the address
                bar.</span
              >
            </li>
            <li class="flex items-center gap-3">
              <span class="grid size-6 shrink-0 place-items-center rounded-full bg-elevated font-mono text-xs">2</span>
              <span
                >Click the pin <UIcon name="i-mingcute-pin-line" class="inline size-4 align-text-bottom" /> next to
                Drop, so its button stays there.</span
              >
            </li>
          </ol>
        </template>
        <p v-if="keys.length" class="text-sm text-muted" data-testid="shortcut">
          Or press
          <span class="inline-flex gap-1 align-middle"><UKbd v-for="key in keys" :key="key" :value="key" /></span>
          on any page.
        </p>
        <p v-else class="text-sm text-muted" data-testid="shortcut">
          You can set a keyboard shortcut for Drop in your browser's extension settings.
        </p>
        <div v-if="!connected" class="flex items-center gap-3 rounded-lg bg-elevated p-4 text-sm">
          <UIcon name="i-mingcute-information-line" class="size-5 shrink-0 text-muted" />
          <span class="flex-1">Not connected yet. Measure and Marker work now. Comment asks you to connect.</span>
          <UButton color="neutral" variant="outline" size="sm" label="Connect" :loading="connecting" @click="connect" />
        </div>
        <ConnectProblem :problem="problem" :detail="detail" :host="host" />
        <div v-if="state?.hand === 'everywhere'" class="flex items-center gap-3 rounded-lg bg-elevated p-4 text-sm">
          <DropMark class="h-3.5 w-6 shrink-0" />
          <span>The hand now waits in the bottom corner of every page.</span>
        </div>
      </section>

      <footer class="mt-10 flex items-center justify-between gap-3 border-t border-default pt-6">
        <UButton
          v-if="step > 1"
          color="neutral"
          variant="ghost"
          icon="i-mingcute-left-line"
          label="Back"
          @click="step--"
        />
        <span v-else />
        <UButton
          v-if="step === 1"
          color="neutral"
          label="Get started"
          trailing-icon="i-mingcute-arrow-right-line"
          @click="step = 2"
        />
        <UButton
          v-else-if="step === 2"
          color="neutral"
          label="Continue"
          :disabled="!choice"
          :loading="busy === 'deployment.set' || busy === 'deployment.reset'"
          @click="saveDrop"
        />
        <UButton v-else-if="step === 3 && connected" color="neutral" label="Continue" @click="step = 4" />
        <span v-else-if="step === 3" class="flex gap-2">
          <UButton color="neutral" variant="ghost" label="Skip for now" @click="step = 4" />
          <UButton color="neutral" label="Connect" :loading="connecting" @click="connect" />
        </span>
        <UButton
          v-else-if="step === 4"
          color="neutral"
          label="Continue"
          :loading="busy === 'hand.set'"
          @click="saveHand"
        />
        <p v-else-if="tried" class="flex items-center gap-2 text-sm text-muted" role="status">
          <UIcon name="i-mingcute-check-line" class="size-4" />Opened example.com in a new tab
        </p>
        <UButton v-else color="neutral" label="Try it on example.com" @click="tryIt" />
      </footer>
    </main>
  </UApp>
</template>
