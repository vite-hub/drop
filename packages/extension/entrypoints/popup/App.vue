<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { browser } from "wxt/browser"
import ConnectProblem from "../../components/ConnectProblem.vue"
import { send, type InjectResult } from "../../lib/messages"
import { allowOrigin, hostOf, setHand, useBackground, useConnect } from "../../lib/page"

const { state, error, busy, act } = useBackground()
const { problem, detail, connecting, connect } = useConnect(state)
const tabId = ref<number>()
const injected = ref<InjectResult>()
const denied = ref<"everywhere" | "site">()

onMounted(async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  tabId.value = tab?.id
  if (tab?.id !== undefined) injected.value = await send("tab.inject", { tabId: tab.id }).catch(() => undefined)
  await act("state.get", tabId.value === undefined ? {} : { tabId: tabId.value })
})

const site = computed(() => state.value?.site)
const siteHost = computed(() => (site.value ? hostOf(site.value.origin) : undefined))
const siteNote = computed(() => {
  if (site.value?.blocked === "drop") return "This is your Drop. Comment here with Drop's own tools."
  if (site.value?.blocked === "unsupported" || (!site.value && injected.value)) return "Drop can't run on this page."
  if (injected.value && !injected.value.ok && injected.value.reason === "failed") return injected.value.error
  return undefined
})
const everywhere = computed(() => state.value?.hand === "everywhere")
const who = computed(() => state.value?.account?.name ?? state.value?.account?.email ?? "Your account")

async function setEverywhere(on: boolean) {
  denied.value = undefined
  const outcome = await setHand(on ? "everywhere" : "press", state.value?.hand, act)
  if (outcome === "denied") denied.value = "everywhere"
}

async function setKept(on: boolean) {
  denied.value = undefined
  const origin = site.value?.origin
  if (!origin) return
  if (!on) await act("site.keep", { origin, keep: false })
  else if (await allowOrigin(origin)) await act("site.keep", { origin, keep: true })
  else denied.value = "site"
}

const openOptions = () => browser.runtime.openOptionsPage()
</script>

<template>
  <UApp>
    <main class="flex w-80 flex-col text-sm">
      <header class="flex items-center gap-2 px-4 pt-4">
        <UIcon name="i-mingcute-world-2-line" class="size-4 shrink-0 text-muted" />
        <span class="truncate font-mono text-sm text-highlighted" data-testid="site">{{ siteHost ?? "No site" }}</span>
      </header>
      <p v-if="siteNote" class="px-4 pt-1 text-xs text-muted">{{ siteNote }}</p>

      <div v-if="state && !state.account" class="flex flex-col gap-2 px-4 pt-4">
        <UButton color="neutral" block label="Connect to Drop" :loading="connecting" @click="connect" />
        <p class="text-center text-xs text-muted">Measure works without it.</p>
        <ConnectProblem :problem="problem" :detail="detail" :host="hostOf(state.drop)" />
      </div>

      <section class="flex flex-col gap-3 p-4" aria-labelledby="hand-heading">
        <h2 id="hand-heading" class="text-xs font-medium text-muted">Show the Drop hand</h2>
        <USwitch
          :model-value="everywhere"
          label="On every page"
          :description="
            denied === 'everywhere'
              ? 'Your browser said no.'
              : everywhere
                ? 'Your browser allowed it.'
                : 'Your browser asks once.'
          "
          :ui="{ description: denied === 'everywhere' ? 'text-error' : undefined }"
          :disabled="!state"
          :loading="busy === 'hand.set'"
          @update:model-value="setEverywhere"
        />
        <USwitch
          :model-value="everywhere || (site?.kept ?? false)"
          label="On this site"
          :description="denied === 'site' ? 'Your browser said no.' : siteHost"
          :ui="{ description: denied === 'site' ? 'text-error' : 'font-mono' }"
          :disabled="everywhere || !site || !!site.blocked"
          :loading="busy === 'site.keep'"
          @update:model-value="setKept"
        />
      </section>

      <p v-if="error" class="px-4 pb-3 text-xs text-error" role="alert">{{ error }}</p>

      <footer class="flex items-center gap-3 border-t border-default px-4 py-3">
        <template v-if="state?.account">
          <UAvatar :alt="who" size="sm" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm text-highlighted" data-testid="account">{{ who }}</p>
            <p class="truncate font-mono text-xs text-muted">{{ hostOf(state.drop) }}</p>
          </div>
        </template>
        <p v-else class="flex-1 text-sm text-muted">Not connected</p>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-mingcute-settings-3-line"
          aria-label="Settings"
          @click="openOptions"
        />
      </footer>
    </main>
  </UApp>
</template>
