<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { normalizeDrop, type DropCheck, type DropProblem } from "../lib/deployment"
import { send, type State } from "../lib/messages"
import { allowOrigin, DEFAULT_DROP, hostOf, releaseOrigin } from "../lib/page"

export interface DropChoice {
  drop: string
  name?: string
}

const props = defineProps<{ state?: State }>()
const choice = defineModel<DropChoice | undefined>("choice")

type Status =
  | { kind: "idle" }
  | { kind: "asking" | "checking"; drop: string }
  | { kind: "found"; drop: string; name: string }
  | { kind: "elsewhere"; drop: string; home: string }
  | { kind: "denied"; drop: string }
  | { kind: "problem"; drop: string; problem: DropProblem | "insecure" }

const where = ref<"hosted" | "own">("hosted")
const address = ref("")
const status = ref<Status>({ kind: "idle" })

let restored = false
watch(
  () => (choice.value ? [choice.value.drop, choice.value.name] : [props.state?.drop, props.state?.dropName]),
  ([drop, name]) => {
    if (!drop || restored) return
    restored = true
    if (drop === DEFAULT_DROP) {
      where.value = "hosted"
      choice.value = { drop }
      return
    }
    where.value = "own"
    address.value = hostOf(drop)
    if (name) {
      status.value = { kind: "found", drop, name }
      choice.value = { drop, name }
    }
  },
  { immediate: true },
)

watch(where, (next) => {
  if (next === "hosted") choice.value = { drop: DEFAULT_DROP }
  else choice.value = status.value.kind === "found" ? { drop: status.value.drop, name: status.value.name } : undefined
})

function edited() {
  status.value = { kind: "idle" }
  choice.value = undefined
}

const host = computed(() => ("drop" in status.value ? hostOf(status.value.drop) : ""))
const failed = computed(() => ["denied", "problem"].includes(status.value.kind))
const problem = computed(() => (status.value.kind === "problem" ? status.value.problem : undefined))
const busy = computed(() => status.value.kind === "asking" || status.value.kind === "checking")

function check() {
  const text = address.value.trim()
  const drop = normalizeDrop(text)
  if (!drop) {
    status.value = { kind: "problem", drop: text, problem: /^http:\/\//i.test(text) ? "insecure" : "invalid-address" }
    return
  }
  void ask(drop)
}

function useHome() {
  if (status.value.kind !== "elsewhere") return
  const home = status.value.home
  address.value = hostOf(home)
  void ask(home)
}

async function ask(drop: string) {
  status.value = { kind: "asking", drop }
  if (await allowOrigin(drop).catch(() => false)) await run(drop)
  else status.value = { kind: "denied", drop }
}

async function run(drop: string) {
  status.value = { kind: "checking", drop }
  const result: DropCheck = await send("deployment.check", { drop }).catch(() => ({
    ok: false,
    error: "unreachable",
  }))
  if (result.ok) {
    status.value = { kind: "found", drop: result.drop, name: result.name }
    choice.value = { drop: result.drop, name: result.name }
    return
  }
  await releaseOrigin(drop, props.state)
  status.value =
    result.error === "elsewhere"
      ? { kind: "elsewhere", drop, home: result.drop }
      : { kind: "problem", drop, problem: result.error }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <URadioGroup
      v-model="where"
      variant="card"
      color="neutral"
      legend="Where is your Drop?"
      :ui="{
        legend: 'sr-only',
        fieldset: 'gap-y-3',
        item: 'p-4 has-data-[state=checked]:border-inverted has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-inverted',
      }"
      :items="[
        { value: 'hosted', label: 'Drop', description: 'drop.vitehub.dev' },
        { value: 'own', label: 'My own Drop', description: 'One that your team runs at its own address' },
      ]"
    >
      <template #description="{ item }">
        <span :class="item.value === 'hosted' ? 'font-mono' : undefined">{{ item.description }}</span>
      </template>
    </URadioGroup>

    <form v-if="where === 'own'" class="flex flex-col gap-2" novalidate @submit.prevent="check">
      <label for="drop-address" class="text-sm font-medium text-highlighted">Your Drop's address</label>
      <div class="flex gap-2">
        <UInput
          id="drop-address"
          v-model="address"
          class="flex-1"
          :ui="{ base: 'font-mono' }"
          :color="failed ? 'error' : undefined"
          :highlight="failed"
          placeholder="drop.example.com"
          autocomplete="off"
          spellcheck="false"
          @update:model-value="edited"
        />
        <UButton type="submit" color="neutral" variant="outline" label="Check" :loading="busy" />
      </div>

      <div aria-live="polite" class="text-sm" data-testid="drop-status">
        <p v-if="status.kind === 'idle'" class="text-muted">
          When you press Check, your browser asks to let Drop talk to this address. Choose Allow.
        </p>
        <p v-else-if="status.kind === 'asking'" class="text-muted">Choose Allow in your browser's window.</p>
        <p v-else-if="status.kind === 'checking'" class="text-muted">
          Checking <span class="font-mono">{{ host }}</span>…
        </p>
        <p v-else-if="status.kind === 'found'" class="flex gap-2 text-default">
          <UIcon name="i-mingcute-check-circle-line" class="mt-0.5 size-4 shrink-0 text-success" />
          <span>Found <b class="font-medium">{{ status.name }}</b> at <span class="font-mono">{{ host }}</span>.</span>
        </p>
        <div v-else-if="status.kind === 'elsewhere'" class="flex flex-col items-start gap-3 rounded-lg bg-elevated p-3">
          <p>
            This Drop lives at <span class="font-mono">{{ hostOf(status.home) }}</span>. Use it? Your browser asks again
            for that address.
          </p>
          <UButton color="neutral" size="sm" :label="`Use ${hostOf(status.home)}`" @click="useHome" />
        </div>
        <p v-else class="flex gap-2 text-error" role="alert">
          <UIcon name="i-mingcute-warning-line" class="mt-0.5 size-4 shrink-0" />
          <span v-if="status.kind === 'denied'"
            >Your browser didn't let Drop check <span class="font-mono">{{ host }}</span>. Press Check and choose
            Allow.</span
          >
          <span v-else-if="problem === 'insecure'"
            >Use an address that starts with https://. Only a Drop on this computer can use http://.</span
          >
          <span v-else-if="problem === 'invalid-address'"
            >That isn't a web address. It looks like drop.example.com.</span
          >
          <span v-else-if="problem === 'unreachable'"
            >Nothing answers at <span class="font-mono">{{ host }}</span>. Check the spelling, or ask whoever runs your
            Drop for its address.</span
          >
          <span v-else-if="problem === 'not-a-drop'"
            ><span class="font-mono">{{ host }}</span> is a website, but not a Drop. Ask whoever runs your Drop for its
            address.</span
          >
          <span v-else-if="problem === 'outdated'"
            >This Drop needs an update before the extension works. Ask whoever runs it to update Drop.</span
          >
          <span v-else-if="problem === 'redirects'"
            ><span class="font-mono">{{ host }}</span> sends visitors on to another address. Type the address you see
            when your Drop is open.</span
          >
          <span v-else
            ><span class="font-mono">{{ host }}</span> has a problem right now. Try again in a few minutes.</span
          >
        </p>
      </div>
    </form>
  </div>
</template>
