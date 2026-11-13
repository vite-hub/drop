<script setup lang="ts">
// A video file, played with media-chrome's controls themed with Drop's shadcn tokens: Kibo UI's Video Player
// (kibo-ui.com/components/video-player), as Vue. The elements register on the client; until then the video sits there
// without controls.
import type { DropComment } from "#shared/types"
import { clock } from "#shared/video-time"

/** A still of the video: the frame on screen as a data URL and a PNG file, the second it's at, and its box on the page. */
export type VideoFrame = {
  src: string
  file: File
  at: number
  rect: { left: number; top: number; width: number; height: number }
}

const props = defineProps<{
  src: string
  type?: string
  title: string
  /** The drop's link: Copy link adds `?t=` to it. */
  link: string
  /** Where `?t=` starts it, in seconds. */
  start?: number
  /** The comments on its frames, drawn along the bottom at their seconds. */
  comments?: DropComment[]
  canComment?: boolean
}>()
const emit = defineEmits<{
  /** Comment on the frame on screen. */
  frame: [frame: VideoFrame]
  /** A comment's marker was clicked. */
  open: [comment: DropComment]
}>()

// The seek bar takes its size once media-chrome draws it.
onMounted(() => import("media-chrome").then(() => customElements.whenDefined("media-time-range").then(placeTrack)))

// Firefox suspends decoding for a video whose window is hidden (behind another app, say), and on macOS a paused one can
// come back without its frame: the player showed nothing, the whole screen in fullscreen. Seeking to where the video
// already is decodes that frame again.
const video = useTemplateRef<HTMLVideoElement>("video")
const visibility = useDocumentVisibility()
watch(visibility, (state) => {
  const element = video.value
  if (state !== "visible" || !element?.paused || element.readyState < HTMLMediaElement.HAVE_METADATA) return
  const at = element.currentTime
  element.currentTime = at
})

const now = ref(0)
const duration = ref(0)
useEventListener(video, "timeupdate", () => (now.value = video.value?.currentTime ?? 0))
useEventListener(video, "seeked", () => (now.value = video.value?.currentTime ?? 0))
const measure = () => {
  const length = video.value?.duration ?? 0
  duration.value = Number.isFinite(length) ? length : 0
}
useEventListener(video, "durationchange", measure)
onMounted(measure)
// A link with `?t=` opens the video paused at that second, its frame showing. The server-rendered video may have its
// length before the page hydrates, so the mounted video goes there at once when it can.
onMounted(() => {
  const element = video.value
  now.value = element?.currentTime ?? 0
  if (!props.start || !element) return
  const go = () => (element.currentTime = Math.min(props.start!, element.duration || props.start!))
  if (element.readyState >= HTMLMediaElement.HAVE_METADATA) go()
  else element.addEventListener("loadedmetadata", go, { once: true })
})

const { copy, copied } = useCopy()
const notify = useNotify()
const second = computed(() => Math.floor(now.value))
const linkLabel = computed(() => (second.value ? `Copy link at ${clock(second.value)}` : "Copy link"))
function copyLink() {
  const url = new URL(props.link)
  if (second.value) url.searchParams.set("t", String(second.value))
  else url.searchParams.delete("t")
  void copy(url.href, {
    key: "video-link",
    announce: second.value ? `Link at ${clock(second.value)} copied` : "Link copied",
  })
}

/** Waits for the video to show the frame at `at`, seeking there when it's elsewhere. */
async function seek(element: HTMLVideoElement, at: number) {
  element.pause()
  if (element.readyState < HTMLMediaElement.HAVE_METADATA)
    await new Promise((resolve) => element.addEventListener("loadedmetadata", resolve, { once: true }))
  if (Math.abs(element.currentTime - at) > 0.01 || element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    const seeked = new Promise((resolve) => element.addEventListener("seeked", resolve, { once: true }))
    element.currentTime = at
    await seeked
  }
}

const pngOf = (element: HTMLVideoElement) =>
  new Promise<Blob>((resolve, reject) => {
    const canvas = document.createElement("canvas")
    canvas.width = element.videoWidth
    canvas.height = element.videoHeight
    const context = canvas.getContext("2d")
    if (!context || !canvas.width) return reject(new Error("The video has no frame to show yet."))
    context.drawImage(element, 0, 0)
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The frame couldn't be drawn."))), "image/png")
  })
const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("load", () => resolve(String(reader.result)))
    reader.addEventListener("error", () => reject(reader.error))
    reader.readAsDataURL(blob)
  })

/** The frame at `at`, or the one on screen. */
async function frameAt(at?: number): Promise<VideoFrame | null> {
  const element = video.value
  if (!element) return null
  await seek(element, at ?? element.currentTime)
  const blob = await pngOf(element)
  const time = element.currentTime
  const box = element.getBoundingClientRect()
  // The picture sits letterboxed in the element: the frame's box is the part it fills.
  const scale = Math.min(box.width / element.videoWidth, box.height / element.videoHeight)
  const width = element.videoWidth * scale,
    height = element.videoHeight * scale
  return {
    src: await dataUrl(blob),
    file: new File([blob], `frame-${clock(time).replaceAll(":", "-")}.png`, { type: "image/png" }),
    at: time,
    rect: { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height },
  }
}

const copiedFrame = ref(false)
const { start: settleFrame } = useTimeoutFn(() => (copiedFrame.value = false), 1400, { immediate: false })
function copyFrame() {
  const element = video.value
  if (!element) return
  element.pause()
  // Safari only lets a click write the clipboard straight away, so the write starts now and waits for the picture.
  const png = pngOf(element)
  void navigator.clipboard.write([new ClipboardItem({ "image/png": png })]).then(
    () => {
      copiedFrame.value = true
      settleFrame()
      return notify.done(`Frame at ${clock(element.currentTime)} copied`)
    },
    (error) => {
      reportClientError("copy", error)
      notify.alert("Couldn't copy the frame")
    },
  )
}

const commenting = ref(false)
async function commentOnFrame() {
  if (commenting.value) return
  commenting.value = true
  try {
    const frame = await frameAt()
    if (frame) emit("frame", frame)
  } catch (error) {
    reportClientError("video-frame", error)
    notify.alert("Couldn't take the frame")
  } finally {
    commenting.value = false
  }
}

// One marker per second that has comments, so two on the same frame don't sit on top of each other.
const markers = computed(() => {
  if (!duration.value) return []
  const bySecond = new Map<number, DropComment[]>()
  for (const comment of props.comments ?? []) {
    if (comment.at === null) continue
    const key = Math.round(comment.at * 10) / 10
    bySecond.set(key, [...(bySecond.get(key) ?? []), comment])
  }
  return [...bySecond].map(([at, comments]) => ({
    at,
    comments,
    left: `${Math.min(100, (at / duration.value) * 100)}%`,
    label: `${clock(at)}: ${comments.map((comment) => `#${comment.n} ${comment.body || "image"}`).join(", ")}`,
  }))
})

// The markers run along the seek bar showing (the narrow player's own row, or the one beside the buttons), inside its
// 10px padding, so each sits over its second on the bar.
const controller = useTemplateRef<HTMLElement>("controller")
const track = ref({ left: 10, width: 0 })
function placeTrack() {
  const host = controller.value
  const range = [...(host?.querySelectorAll("media-time-range") ?? [])].find(
    (item) => item.getBoundingClientRect().width,
  )
  if (!host || !range) return
  const outer = host.getBoundingClientRect(),
    inner = range.getBoundingClientRect()
  track.value = { left: inner.left - outer.left + 10, width: Math.max(0, inner.width - 20) }
}
useResizeObserver(controller, placeTrack)
watch(
  () => markers.value.length,
  () => nextTick(placeTrack),
)

defineExpose({ frameAt })

const variables = {
  "--media-primary-color": "var(--primary)",
  "--media-secondary-color": "var(--background)",
  "--media-text-color": "var(--foreground)",
  "--media-control-hover-background": "var(--accent)",
  "--media-font-family": "var(--font-sans)",
  "--media-range-track-background": "color-mix(in srgb, var(--foreground) 25%, transparent)",
}
</script>

<template>
  <!-- The stage runs under the review dock and keeps the dock's height clear at its bottom, so the controls stay clickable. -->
  <div class="flex min-h-0 flex-1 flex-col bg-elevated px-4 pt-4 pb-28 sm:px-8 sm:pt-8 sm:pb-20">
    <!-- A size container: cap the video at this box's height; Media Chrome overlays the control bars on the video. -->
    <div class="grid min-h-0 flex-1 place-items-center [container-type:size]">
      <div class="flex max-h-full w-full max-w-7xl flex-col gap-2">
        <!-- The stage caps the video's height and fills the letterbox with the page; fullscreen fills the screen, letterboxed in black. -->
        <media-controller
          ref="controller"
          class="@container block min-h-0 w-full overflow-hidden rounded-lg border border-default shadow-lg [--media-background-color:var(--background)] [&[mediaisfullscreen]]:rounded-none [&[mediaisfullscreen]]:border-0 [&[mediaisfullscreen]]:[--media-background-color:#000]"
          :style="variables"
        >
          <video
            ref="video"
            slot="media"
            class="block w-full in-[[mediaisfullscreen]]:h-full in-[[mediaisfullscreen]]:max-h-none!"
            :class="markers.length ? 'max-h-[calc(100cqh-2.25rem)]' : 'max-h-[100cqh]'"
            :aria-label="title"
            playsinline
            preload="metadata"
          >
            <source :src="src" :type="type" />
          </video>
          <!-- A narrow player can't fit the seek bar beside its buttons, so it gets a row of its own above them. -->
          <media-control-bar class="w-full @2xl:hidden">
            <media-time-range class="flex-1 px-2.5" />
          </media-control-bar>
          <media-control-bar class="w-full">
            <media-play-button class="p-2.5" />
            <media-seek-backward-button class="hidden p-2.5 @md:inline-flex" seekoffset="10" />
            <media-seek-forward-button class="hidden p-2.5 @md:inline-flex" seekoffset="10" />
            <media-time-range class="hidden flex-1 p-2.5 @2xl:inline-flex" />
            <media-time-display class="mr-auto p-2.5 font-mono tabular-nums @2xl:mr-0" showduration />
            <UTooltip v-if="canComment" text="Comment on this frame">
              <button
                class="video-action"
                type="button"
                aria-label="Comment on this frame"
                :disabled="commenting"
                @click="commentOnFrame"
              >
                <UIcon name="i-mingcute-chat-3-line" class="size-5" />
              </button>
            </UTooltip>
            <UTooltip :text="linkLabel">
              <button class="video-action" type="button" :aria-label="linkLabel" @click="copyLink">
                <UIcon :name="copied('video-link') ? 'i-mingcute-check-line' : 'i-mingcute-link-line'" class="size-5" />
              </button>
            </UTooltip>
            <UTooltip text="Copy frame">
              <button class="video-action" type="button" aria-label="Copy frame" @click="copyFrame">
                <UIcon :name="copiedFrame ? 'i-mingcute-check-line' : 'i-mingcute-pic-line'" class="size-5" />
              </button>
            </UTooltip>
            <media-mute-button class="p-2.5" />
            <media-volume-range class="hidden p-2.5 @2xl:inline-flex" />
            <media-playback-rate-button class="p-2.5" />
            <media-fullscreen-button class="p-2.5" />
          </media-control-bar>
        </media-controller>
        <!-- The comments on its frames, each at its second along the video's length. -->
        <div
          v-if="markers.length"
          class="relative h-7 shrink-0"
          role="group"
          aria-label="Comments on frames"
          :style="{ marginLeft: `${track.left}px`, width: track.width ? `${track.width}px` : undefined }"
        >
          <UTooltip v-for="marker in markers" :key="marker.at" :text="marker.label">
            <button
              type="button"
              class="frame-marker"
              :class="{ done: marker.comments.every((comment) => comment.resolved) }"
              :style="{ left: marker.left }"
              :aria-label="`Comment ${marker.label}`"
              @click="emit('open', marker.comments[0]!)"
            >
              {{ marker.comments.length > 1 ? marker.comments.length : marker.comments[0]!.n }}
            </button>
          </UTooltip>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.video-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.625rem;
  /* media-chrome's own buttons' surface, so the picture doesn't show through the bar. */
  color: var(--media-text-color);
  background: var(--media-control-background, var(--media-secondary-color));
  cursor: pointer;
}
.video-action:hover {
  background: var(--media-control-hover-background);
}
.video-action:disabled {
  opacity: 0.5;
  cursor: progress;
}
.video-action:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
/* Drop's pin (shared/plan-runtime.ts), its sharp corner on the second it's at. */
.frame-marker {
  position: absolute;
  top: 0;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 2px 11px 11px 11px;
  background: var(--primary);
  color: var(--primary-foreground);
  font: 600 10px/22px var(--font-sans);
  font-variant-numeric: tabular-nums;
  box-shadow:
    0 1px 4px rgb(0 0 0 / 0.25),
    0 0 0 2px var(--background);
  cursor: pointer;
  transition: scale 150ms cubic-bezier(0.23, 1, 0.32, 1);
}
.frame-marker:hover {
  scale: 1.1;
}
.frame-marker:active {
  scale: 0.96;
}
.frame-marker.done {
  opacity: 0.55;
  filter: grayscale(1);
}
.frame-marker:focus-visible {
  outline: 2px solid var(--foreground);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .frame-marker {
    transition: none;
  }
}
</style>
