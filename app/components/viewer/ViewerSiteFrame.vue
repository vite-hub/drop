<script setup lang="ts">
// A site under review, open inside Drop: the page in a frame, an address bar above it, and Comment, which draws a box
// over the frame and screenshots it with the browser's screen capture. Drop can't read a frame from another origin,
// so a comment carries the screenshot, the box, and the address typed above, never the element under the box. Comments
// are stored like the review script's (POST /api/drops/:id/review), so the list and agents read them the same way.
import { siteMatches } from "#shared/review"
import type { DropDetail } from "#shared/types"

/** `inset`: room to leave on the right for the floating panel, in pixels. */
const props = defineProps<{ drop: DropDetail; address: string; inset: number }>()
const emit = defineEmits<{ close: [] }>()

const notify = useNotify()
const capture = useTabCapture()

// What's typed, and what the frame has open. Clicks inside the frame can't reach Drop, so the bar only changes when
// someone types in it.
const typed = ref(props.address)
const open = ref(props.address)
const covered = (value: string) => {
  try { return Boolean(props.drop.siteUrl) && siteMatches(props.drop.siteUrl!, new URL(value).origin) }
  catch { return false }
}
const valid = computed(() => covered(typed.value))
function go() {
  if (valid.value) open.value = new URL(typed.value).href
}

type Box = { left: number; top: number; width: number; height: number }
const stage = useTemplateRef("stage")
const drawing = ref(false)
const box = ref<Box | null>(null)
let from: { x: number; y: number } | null = null
const pending = ref<{ blob: Blob; url: string; box: Box; size: { width: number; height: number }; page: string; origin: string } | null>(null)
const note = ref("")
const sending = ref(false)

async function comment() {
  if (pending.value) return
  if (drawing.value) return (drawing.value = false)
  if (!capture.supported()) {
    notify.info({ title: "This browser can't capture the screen", description: "Use the bookmarklet on the site instead.", color: "error", icon: "i-ph-warning-circle" })
    return
  }
  if (!capture.active.value) {
    try { await capture.start() }
    catch (error) {
      // Closing the browser's share dialog is a choice, not a failure.
      if ((error as DOMException).name !== "NotAllowedError") notify.fail("Couldn't start the screen capture", error)
      return
    }
  }
  box.value = null
  drawing.value = true
}

function point(event: PointerEvent) {
  const rect = stage.value!.getBoundingClientRect()
  return { x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width), y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height) }
}
function down(event: PointerEvent) {
  (event.target as HTMLElement).setPointerCapture(event.pointerId)
  from = point(event)
  box.value = { left: from.x, top: from.y, width: 0, height: 0 }
}
function move(event: PointerEvent) {
  if (!from) return
  const to = point(event)
  box.value = { left: Math.min(from.x, to.x), top: Math.min(from.y, to.y), width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) }
}
async function up() {
  const drawn = box.value
  from = null
  if (!drawn || drawn.width < 8 || drawn.height < 8) return (box.value = null)
  const rect = stage.value!.getBoundingClientRect()
  // Hide the crosshair and the box first, so the screenshot shows the page as it is.
  drawing.value = false
  box.value = null
  await nextTick()
  await new Promise(requestAnimationFrame)
  try {
    const blob = await capture.grab({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    const url = new URL(open.value)
    pending.value = {
      blob, url: URL.createObjectURL(blob), box: drawn,
      size: { width: Math.round(rect.width), height: Math.round(rect.height) },
      page: (url.pathname + url.search + url.hash).slice(0, 1000), origin: url.origin,
    }
  }
  catch (error) {
    notify.fail("Couldn't take the screenshot", error)
  }
}

function discard() {
  if (pending.value) URL.revokeObjectURL(pending.value.url)
  pending.value = null
  note.value = ""
}

// The box in thousandths of the screenshot, as every review comment stores it.
const thousandths = (value: number, whole: number) => Math.min(1000, Math.max(0, Math.round((value / whole) * 1000)))
const percent = (value: number, whole: number) => `${(value / whole) * 100}%`

async function send() {
  const shot = pending.value
  if (!shot || !note.value.trim()) return
  const { box: b, size } = shot
  const ox = thousandths(b.left, size.width), oy = thousandths(b.top, size.height)
  const form = new FormData()
  form.append("data", JSON.stringify({
    body: note.value.trim(), page: shot.page, ox, oy,
    ow: Math.max(1, Math.min(1000 - ox, thousandths(b.width, size.width))), oh: Math.max(1, Math.min(1000 - oy, thousandths(b.height, size.height))),
    viewport: size,
  }))
  form.append("screenshot", shot.blob, "screenshot")
  sending.value = true
  try {
    await $fetch(`/api/drops/${props.drop.id}/review`, { method: "POST", query: { origin: shot.origin }, body: form })
    notify.done("Comment sent", "It's on the site's page with its screenshot.")
    discard()
    // By key, not by an event: someone can go back while the upload is still running, and an unmounted component's
    // events go nowhere.
    void refreshNuxtData([`review:${props.drop.id}`, `comments:${props.drop.id}`])
  }
  catch (error) {
    notify.fail("Couldn't send the comment", error)
  }
  finally {
    sending.value = false
  }
}

onKeyStroke("Escape", () => {
  if (pending.value) discard()
  else drawing.value = false
})
onBeforeUnmount(discard)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" :style="{ paddingRight: inset ? `${inset}px` : undefined }">
    <div class="flex h-12 shrink-0 items-center gap-2 border-b border-default px-3">
      <UButton color="neutral" icon="i-ph-arrow-left" variant="ghost" aria-label="Back to the site's comments" @click="emit('close')" />
      <form class="min-w-0 flex-1" @submit.prevent="go">
        <UInput v-model="typed" class="w-full" :color="valid ? 'neutral' : 'error'" :highlight="!valid" icon="i-ph-globe" size="sm" aria-label="Address of the page under review" spellcheck="false" />
      </form>
      <UButton color="neutral" :variant="drawing ? 'solid' : 'outline'" icon="i-ph-chat-circle" :label="drawing ? 'Drawing…' : 'Comment'" @click="comment" />
    </div>
    <p v-if="!valid" class="border-b border-default px-3 py-1.5 text-xs text-error">That address isn't part of this site ({{ drop.siteUrl }}).</p>
    <p v-else-if="capture.active.value && !capture.exact.value" class="border-b border-default px-3 py-1.5 text-xs text-muted">You shared a window, not this tab, so a screenshot may be slightly off. Check it before you send.</p>

    <div ref="stage" class="relative min-h-0 flex-1 bg-muted">
      <iframe :key="open" class="absolute inset-0 size-full border-0 bg-white" :src="open" :title="`${drop.title}: the site under review`" />
      <div v-if="drawing" class="absolute inset-0 cursor-crosshair touch-none bg-inverted/5" @pointerdown="down" @pointermove="move" @pointerup="up">
        <div v-if="box" class="absolute rounded-sm border-2 border-inverted bg-inverted/10" :style="{ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }" />
        <p v-else class="absolute top-3 left-1/2 -translate-x-1/2 rounded-md border border-default bg-default px-3 py-1.5 text-sm shadow-sm">Drag over what you mean. <UKbd value="escape" /> cancels.</p>
      </div>

      <form v-if="pending" class="absolute right-4 bottom-4 w-80 space-y-3 rounded-lg border border-default bg-default p-3 shadow-lg" @submit.prevent="send">
        <div class="relative overflow-hidden rounded-md border border-default">
          <img :alt="`Screenshot of ${pending.page}`" class="block w-full" :src="pending.url">
          <span class="absolute rounded-sm border-2 border-inverted" :style="{ left: percent(pending.box.left, pending.size.width), top: percent(pending.box.top, pending.size.height), width: percent(pending.box.width, pending.size.width), height: percent(pending.box.height, pending.size.height) }" />
        </div>
        <UTextarea v-model="note" autofocus autoresize class="w-full" :maxrows="8" placeholder="What should change here?" :rows="3" @keydown.meta.enter="send" @keydown.ctrl.enter="send" />
        <div class="flex justify-end gap-2">
          <UButton color="neutral" label="Cancel" variant="ghost" @click="discard" />
          <UButton color="neutral" :disabled="!note.trim()" label="Send" :loading="sending" type="submit" />
        </div>
      </form>
    </div>
  </div>
</template>
