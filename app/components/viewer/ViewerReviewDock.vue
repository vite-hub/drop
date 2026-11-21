<script setup lang="ts">
// The list, thread, and composer rise above the pill. Only the pill is dark, like the HTML prototype picker; the panel
// is a floating surface in the page's own theme, as every popover from the pill is.
defineOptions({ inheritAttrs: false })
// settle: what to wait for before the composer takes focus, which the drop's frame would otherwise hear it lose.
// heading: how the panel's top row is drawn, so it never stacks a second row over one its content already has. "row" is
// the dock's own row with the title; "none" leaves the row to the content (a list or thread with its own actions).
// folded: zen mode with nothing that needs the pill, which then folds to a small handle (#handle, labeled handleLabel). A
// press on the handle shows the pill again for a while, a peek, without leaving zen.
const props = defineProps<{
  open: boolean
  heading: "row" | "none"
  title?: string
  overlay?: boolean
  settle?: () => Promise<void>
  folded?: boolean
  handleLabel?: string
}>()
const emit = defineEmits<{ close: [] }>()
const peek = defineModel<boolean>("peek", { default: false })
useHead({ htmlAttrs: { "data-vitehub-pill": "mark" } })
const root = useTemplateRef<HTMLElement>("root")
const panel = useTemplateRef<HTMLElement>("panel")
const toolbar = useTemplateRef<HTMLElement>("toolbar")
// Its top follows wrapped touch controls and the dock's safe-area offset, without counting an open comments panel.
const { top } = useElementBounding(toolbar)
function focusTrigger() {
  root.value?.querySelector<HTMLButtonElement>("[data-review-trigger]")?.focus({ preventScroll: true })
}
defineExpose({ focusTrigger, top })

const handle = useTemplateRef<HTMLElement>("handle")
const collapsed = computed(() => Boolean(props.folded) && !peek.value)
// Whatever unfolded the pill (a mode, a popover, zen turned off) ends the peek with it: once it's done, the pill folds.
watch(
  () => props.folded,
  (folded) => !folded && (peek.value = false),
)
// The pill folds into the handle's box, so it closes on the handle rather than fading where it was.
const { width: handleWidth, height: handleHeight } = useElementSize(handle, undefined, { box: "border-box" })
const foldTo = computed(() => ({
  "--handle-width": `${handleWidth.value || 40}px`,
  "--handle-height": `${handleHeight.value || 28}px`,
}))
// A press of the handle with a key (no pointer, so no click count) takes the focus into the pill, where the handle was.
async function showPill(event: MouseEvent) {
  peek.value = true
  if (event.detail !== 0) return
  await nextTick()
  toolbar.value?.querySelector<HTMLElement>("button:not(:disabled), a[href]")?.focus({ preventScroll: true })
}
// A peek ends as the mouse leaves the pill, unless a menu it opened is showing over the page; as the focus leaves it,
// but not for that menu; and on a press outside it, which is how a touch screen, with no pointer to leave, ends it.
// The frame takes presses without Drop's window hearing them, so a press there counts once the frame takes the focus.
const POPPER = "[data-reka-popper-content-wrapper]"
function pointerLeft(event: PointerEvent) {
  if (!peek.value || event.pointerType === "touch") return
  if (toolbar.value?.contains(document.activeElement)) return
  if (!toolbar.value?.querySelector('[aria-expanded="true"]')) peek.value = false
}
function focusLeft(event: FocusEvent) {
  const to = event.relatedTarget
  if (!peek.value || (to instanceof Element && (toolbar.value?.contains(to) || to.closest(POPPER)))) return
  peek.value = false
}
onClickOutside(toolbar, () => (peek.value = false), { ignore: [handle, POPPER], detectIframe: true })
// A press on the bar leaves focus in the drop's frame. The page there would hear it go and close what it has open, such
// as the tooltip someone is about to comment on. Keys and the composer still move focus.
function keepFrameFocus(event: MouseEvent) {
  if (
    document.activeElement instanceof HTMLIFrameElement &&
    event.target instanceof Element &&
    event.target.closest("button")
  )
    event.preventDefault()
}
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await nextTick()
    await props.settle?.()
    if (!props.open) return
    const target = panel.value?.querySelector<HTMLElement>("[data-comment-editor] textarea") ?? panel.value
    target?.focus({ preventScroll: true })
  },
)
</script>

<template>
  <Teleport to="body" :disabled="!overlay">
    <div
      v-bind="$attrs"
      ref="root"
      class="@container/review-dock pointer-events-none inset-x-2 bottom-[max(1rem,env(safe-area-inset-bottom))] flex max-h-[calc(100%-2rem)] flex-col items-center gap-2 sm:inset-x-4"
      :class="overlay ? 'fixed z-[60]' : 'absolute z-30'"
    >
      <!-- Rises out of the bar it opens from; closing is quicker and quieter, since the reader has moved on. -->
      <Transition
        enter-active-class="motion-safe:transition-[opacity,translate,scale] motion-safe:duration-200 motion-safe:ease-(--ease-out)"
        enter-from-class="translate-y-2 scale-[0.98] opacity-0"
        leave-active-class="motion-safe:transition-[opacity,translate,scale] motion-safe:duration-150 motion-safe:ease-(--ease-out)"
        leave-to-class="translate-y-1 scale-[0.98] opacity-0"
      >
        <section
          v-show="open"
          id="drop-comments"
          ref="panel"
          aria-label="Comments"
          tabindex="-1"
          class="pointer-events-auto relative flex h-[min(28rem,60dvh)] origin-bottom min-h-0 w-full max-w-md flex-col overflow-hidden rounded-[12px] bg-default shadow-md ring ring-default outline-none focus-visible:ring-2 focus-visible:ring-inverted"
          @keydown.esc.stop.prevent="emit('close')"
        >
          <div
            v-if="heading === 'row'"
            class="flex h-11 shrink-0 items-center gap-1 border-b border-default pr-1.5 pl-4"
          >
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ title }}</span>
            <UButton
              aria-label="Collapse comments"
              color="neutral"
              icon="i-mingcute-down-line"
              size="sm"
              variant="ghost"
              @click="emit('close')"
            />
          </div>
          <div class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"><slot name="panel" /></div>
        </section>
      </Transition>
      <!-- The pill and, under zen, its handle share one place at the bottom: the pill folds into the handle there. -->
      <div class="grid max-w-full shrink-0 justify-items-center" :style="foldTo">
        <div
          ref="toolbar"
          role="group"
          aria-label="Document tools"
          @focusout="focusLeft"
          @mousedown="keepFrameFocus"
          @pointerleave="pointerLeft"
          class="review-toolbar pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-0.5 self-end rounded-[12px] border border-default surface-review p-1 [grid-area:1/1]"
          :class="{ folded: collapsed }"
          :inert="collapsed"
        >
          <slot name="toolbar" />
        </div>
        <UTooltip
          v-if="$slots.handle"
          :disabled="!collapsed"
          text="Show tools"
          :kbds="['Z']"
          :content="{ side: 'top', sideOffset: 8 }"
        >
          <button
            ref="handle"
            :aria-label="handleLabel ?? 'Show tools'"
            class="review-handle pointer-events-auto self-end border border-default surface-review [grid-area:1/1]"
            :class="{ away: !collapsed }"
            :inert="!collapsed"
            type="button"
            @mousedown="keepFrameFocus"
            @click="showPill"
          >
            <slot name="handle" />
          </button>
        </UTooltip>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.review-toolbar {
  font:
    500 12px/1 ui-sans-serif,
    system-ui,
    sans-serif;
  /* Unfolding: the pill grows out of the handle and shows at once, as the + segment grows. */
  clip-path: inset(0 0 0 0 round 12px);
  transition:
    clip-path 250ms var(--ease-out),
    opacity 120ms var(--ease-out),
    visibility 0s;
}

/* Folding: it closes on the handle's box, and fades only once it's nearly there, so it reads as shrinking, not vanishing. */
.review-toolbar.folded {
  clip-path: inset(
    calc(100% - var(--handle-height)) calc(50% - var(--handle-width) / 2) 0 calc(50% - var(--handle-width) / 2) round
      10px
  );
  opacity: 0;
  visibility: hidden;
  transition:
    clip-path 250ms var(--ease-out),
    opacity 150ms var(--ease-out) 100ms,
    visibility 0s 250ms;
}

/* Zen's handle: Drop's mark, with a count of open comments and a dot for each person here, so neither goes unseen. */
.review-handle {
  position: relative;
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 6px;
  border-radius: 10px;
  padding: 0 8px;
  color: var(--ui-text-toned);
  font:
    500 11px/1 ui-sans-serif,
    system-ui,
    sans-serif;
  font-variant-numeric: tabular-nums;
  touch-action: manipulation;
  transition:
    opacity 150ms var(--ease-out) 100ms,
    scale 150ms var(--ease-out),
    color 150ms var(--ease-out),
    visibility 0s;
}

.review-handle.away {
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 80ms var(--ease-out),
    visibility 0s 80ms;
}

@media (hover: hover) {
  .review-handle:hover {
    color: var(--ui-text);
  }
}

.review-handle:active {
  scale: 0.96;
}

.review-handle:focus-visible {
  outline: 1px solid rgb(255 255 255 / 45%);
  outline-offset: 1px;
}

/* A finger gets 44px to press, while the handle still looks small. */
@media (pointer: coarse) {
  .review-handle::before {
    position: absolute;
    inset: -9px -4px;
    content: "";
  }
}

:root:has(> :is(vitehub-pill, vitehub-tools-off)[edge="bottom"]) .review-toolbar {
  max-width: calc(100% - 6rem);
}

@container review-dock (width < 40rem) {
  .review-toolbar :deep([data-slot="comment-send"]:is([data-state="pairing"], [data-state="confirm"])) {
    width: 100%;
    justify-content: center;
  }

  .review-toolbar :deep(:is([data-state="pairing"], [data-state="confirm"]) [data-slot="comment-send-content"]) {
    min-width: 0;
    flex-wrap: wrap;
    justify-content: center;
  }

  .review-toolbar
    :deep(:is([data-state="pairing"], [data-state="confirm"]) [data-slot="comment-send-status"]:not([data-icon])) {
    flex: 0 1 100%;
    min-width: 0;
    height: auto;
    padding-block: 4px;
    line-height: 1.35;
    white-space: normal;
    overflow-wrap: anywhere;
  }
}

.review-toolbar :deep(button) {
  min-width: 28px;
  height: 28px;
  gap: 4px;
  border-radius: 8px;
  padding: 0 8px;
  background: transparent;
  /* Toned, not muted: muted at the disabled 75% opacity fell to 4.1:1 over light pages. */
  color: var(--ui-text-toned);
  font: inherit;
  touch-action: manipulation;
  transition-property: background-color, color, scale;
  transition-duration: 150ms;
  transition-timing-function: var(--ease-out);
}

.review-toolbar :deep([aria-label="Preview tools"] button),
.review-toolbar :deep([data-marker] button[data-icon]) {
  width: 28px;
  padding: 0;
}

/* Gated so a tap on a touch screen doesn't leave the button lit. */
@media (hover: hover) {
  .review-toolbar :deep(button:where(:not(:disabled):hover)) {
    background: rgb(255 255 255 / 8%);
    color: var(--ui-text);
  }
}

.review-toolbar :deep(button:where(:not(:disabled):active)) {
  scale: 0.96;
}

/* Send's Allow and send N is the one action its segment inverts (vite-hub/ui's data-variant="on"). */
.review-toolbar :deep(button[aria-pressed="true"]),
.review-toolbar :deep(button[aria-expanded="true"]),
.review-toolbar :deep(button[data-review-primary]),
.review-toolbar :deep(button[data-variant="on"]) {
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

/* Closing the panel with Esc hands focus back to Comments. A solid white ring outside the button boxed it in against the
   pill's edge, so focus is the hover's fill with a grey hairline inside, still 4.5:1 against the pill. Send's Open
   thread is a link that looks like a button, so it focuses as one. */
.review-toolbar :deep(button:focus-visible),
.review-toolbar :deep(a[data-slot="comment-send-action"]:focus-visible) {
  outline: 1px solid rgb(255 255 255 / 45%);
  outline-offset: -1px;
}

.review-toolbar
  :deep(
    button:focus-visible:not([aria-pressed="true"], [aria-expanded="true"], [data-review-primary], [data-variant="on"])
  ),
.review-toolbar :deep(a[data-slot="comment-send-action"]:focus-visible) {
  background: rgb(255 255 255 / 8%);
  color: var(--ui-text);
}

/* A pressed button is already white, so its hairline sits just outside. */
.review-toolbar
  :deep(
    button:focus-visible:is([aria-pressed="true"], [aria-expanded="true"], [data-review-primary], [data-variant="on"])
  ) {
  outline-offset: 1px;
}

.review-toolbar :deep(button > .iconify) {
  width: 14px;
  height: 14px;
}

@media (prefers-reduced-motion: reduce) {
  .review-toolbar,
  .review-toolbar.folded,
  .review-handle,
  .review-handle.away,
  .review-toolbar :deep(button) {
    transition: none;
  }
}

@media (pointer: coarse) {
  .review-toolbar :deep(button) {
    min-width: 44px;
    height: 44px;
  }
}
</style>
