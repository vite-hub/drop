<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { browser } from "wxt/browser"
import DropMark from "../../../../app/components/DropMark.vue"
import AccountLink from "../../components/AccountLink.vue"
import { send, type InjectResult } from "../../lib/messages"
import { allowEverywhere, allowOrigin, useBackground } from "../../lib/page"

const { state, error, busy, act } = useBackground()
const tabId = ref<number>()
const injected = ref<InjectResult>()
const denied = ref<string>()

onMounted(async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  tabId.value = tab?.id
  if (tab?.id !== undefined) injected.value = await send("tab.inject", { tabId: tab.id }).catch(() => undefined)
  await act("state.get", tabId.value === undefined ? {} : { tabId: tabId.value })
})

const site = computed(() => state.value?.site)
const siteNote = computed(() => {
  if (site.value?.blocked === "drop") return "This is your Drop. Comment here with Drop's own tools."
  if (site.value?.blocked === "unsupported" || (!site.value && injected.value)) return "Drop can't run on this page."
  if (injected.value && !injected.value.ok && injected.value.reason === "failed") return injected.value.error
  return undefined
})

async function setEverywhere(on: boolean) {
  denied.value = undefined
  if (!on) await act("hand.set", { hand: "press" })
  else if (await allowEverywhere()) await act("hand.set", { hand: "everywhere" })
  else denied.value = "everywhere"
}

async function setKept(on: boolean) {
  denied.value = undefined
  const origin = site.value?.origin
  if (!origin) return
  if (!on) await act("site.keep", { origin, keep: false })
  else if (await allowOrigin(origin)) await act("site.keep", { origin, keep: true })
  else denied.value = "site"
}

const reload = () => act("state.get", tabId.value === undefined ? {} : { tabId: tabId.value })
</script>

<template>
  <UApp>
    <main class="flex w-80 flex-col gap-4 p-4">
      <header class="flex items-center gap-2">
        <DropMark class="size-5" />
        <span class="text-sm font-semibold">Drop</span>
      </header>

      <section class="flex flex-col gap-1">
        <p class="truncate font-mono text-xs" data-testid="site">{{ site?.origin ?? "No site" }}</p>
        <p v-if="siteNote" class="text-xs text-muted">{{ siteNote }}</p>
      </section>

      <AccountLink :state="state" :busy="busy === 'link.start'" @connect="act('link.start', {}).then(() => reload())" />

      <section class="flex flex-col gap-3">
        <USwitch
          :model-value="state?.hand === 'everywhere'"
          label="On every page"
          :description="denied === 'everywhere' ? 'Not allowed.' : undefined"
          :disabled="!state"
          @update:model-value="setEverywhere"
        />
        <USwitch
          :model-value="site?.kept ?? false"
          :label="site?.kept ? 'On this site' : 'Keep Drop on this site'"
          :description="denied === 'site' ? 'Not allowed.' : undefined"
          :disabled="!site || !!site.blocked"
          @update:model-value="setKept"
        />
      </section>

      <p v-if="error" class="text-xs text-error">{{ error }}</p>

      <footer>
        <UButton
          color="neutral"
          variant="link"
          size="sm"
          class="px-0"
          label="Settings"
          @click="browser.runtime.openOptionsPage()"
        />
      </footer>
    </main>
  </UApp>
</template>
