import * as v from "valibot"
import { MAX_QUIZ_BLOCKS, QuizAnswerInput, QuizId } from "./quiz"

// What a drop's frame posts up to the viewer: the comment layer (shared/plan-runtime.ts), an app's page runtime
// (shared/project-bundle.ts), and the content origin's frame host (server/utils/content-origin.ts). Frames run the
// drop's own code, which can post anything, so the viewer parses each message here and drops what doesn't fit.

const Rect = v.object({ left: v.number(), top: v.number(), right: v.number(), bottom: v.number() })
const path = { path: v.string() }

/** The most variants a prototype's message lists (the prototype skill asks for 3 to 6). */
const MAX_VARIANTS = 100

const RuntimeErrorKind = v.picklist(["error", "rejection", "console", "load"])

export const FrameMessage = v.variant("type", [
  v.object({ type: v.literal("ready") }),
  v.object({ type: v.literal("navigate"), ...path }),
  v.object({ type: v.literal("host"), ...path }),
  v.object({ type: v.literal("location"), ...path }),
  v.object({ type: v.literal("frame-request"), id: v.string(), ...path }),
  v.object({ type: v.literal("copy"), text: v.string() }),
  // The /f/ paths of a Markdown doc's images, videos, and audio that came near the screen (DEFERRED_FILES_SCRIPT in
  // ./documents).
  v.object({ type: v.literal("files"), paths: v.pipe(v.array(v.string()), v.maxLength(100)) }),
  // The links of a Markdown doc's `::drop` boxes that came near the screen (EMBEDS_SCRIPT in ./documents).
  v.object({ type: v.literal("embeds"), links: v.pipe(v.array(v.string()), v.maxLength(20)) }),
  // A cleared selection carries nothing else.
  v.variant("clear", [
    v.object({ type: v.literal("selection"), clear: v.literal(true) }),
    v.object({
      type: v.literal("selection"),
      clear: v.optional(v.literal(false)),
      quote: v.string(),
      selector: v.string(),
      label: v.string(),
      rect: Rect,
    }),
  ]),
  v.object({
    type: v.literal("image"),
    src: v.string(),
    alt: v.string(),
    selector: v.string(),
    label: v.string(),
    rect: v.optional(Rect),
  }),
  v.object({
    type: v.literal("area"),
    // "image": drawn on a screenshot in Comark's zoom, which anchors to the image as Drop's lightbox does.
    kind: v.optional(v.picklist(["area", "image"])),
    selector: v.string(),
    label: v.string(),
    ox: v.number(),
    oy: v.number(),
    ow: v.number(),
    oh: v.number(),
    rect: Rect,
    // On something that shows only for a while, or from the Marker: the number of the "area-shot" with its picture,
    // which follows.
    shot: v.optional(v.number()),
    // From the Marker: the words under its strokes.
    quote: v.optional(v.pipe(v.string(), v.maxLength(2000))),
  }),
  // null: the picture couldn't be taken.
  v.object({ type: v.literal("area-shot"), shot: v.number(), image: v.nullable(v.blob()) }),
  // The tool the comment layer is under, once it has it: under any but browse, the page is held (EVENT_HOLD).
  v.object({ type: v.literal("tool"), tool: v.picklist(["browse", "comment", "measure", "mark"]) }),
  // How many strokes the Marker's snapshot holds, after each one and each undo.
  v.object({ type: v.literal("marks"), count: v.pipe(v.number(), v.integer(), v.minValue(0)) }),
  // A click on a pin, or (`focused`) the pin a "focus" with `open` scrolled to.
  v.object({
    type: v.literal("marker"),
    id: v.string(),
    clientX: v.number(),
    clientY: v.number(),
    focused: v.optional(v.boolean()),
  }),
  v.object({ type: v.literal("unplaced"), ids: v.array(v.string()) }),
  // The toolbar's keys, pressed while the page had focus, with the tool it was under (apps keep their keys under Browse).
  // B, P, and A pick the Marker's tips, [ and ] its size.
  // An image's page sends ← and → too, for those keys or a sideways swipe: they move to the folder's other images.
  v.object({
    type: v.literal("key"),
    key: v.picklist(["Escape", "v", "r", "s", "u", "x", "b", "p", "a", "[", "]", "ArrowLeft", "ArrowRight"]),
    tool: v.optional(v.picklist(["browse", "comment", "measure", "mark"])),
  }),
  v.object({
    type: v.literal("runtime-error"),
    kind: RuntimeErrorKind,
    message: v.string(),
    source: v.optional(v.string()),
  }),
  // A Markdown doc's questions, polls, and recall cards (QUIZ_BRIDGE in ./plan-runtime): the blocks on the page once
  // comark-quiz's script starts, and each answer a reader gives.
  v.object({ type: v.literal("quiz-ready"), ids: v.pipe(v.array(QuizId), v.maxLength(MAX_QUIZ_BLOCKS)) }),
  v.object({ type: v.literal("quiz-answer"), answer: QuizAnswerInput }),
  // A prototype's variants and the one showing, from the prototype skill's picker.js, for Drop's bottom bar to show.
  v.pipe(
    v.object({
      type: v.literal("variants"),
      variants: v.pipe(
        v.array(
          v.object({
            id: v.pipe(v.string(), v.maxLength(200)),
            label: v.pipe(v.string(), v.maxLength(200)),
            note: v.pipe(v.string(), v.maxLength(500)),
          }),
        ),
        v.minLength(1),
        v.maxLength(MAX_VARIANTS),
      ),
      current: v.pipe(v.number(), v.integer(), v.minValue(0)),
      canvas: v.boolean(),
      zoom: v.pipe(v.number(), v.minValue(0), v.maxValue(1000)),
    }),
    v.check((message) => message.current < message.variants.length),
  ),
])

export type FrameMessage = v.InferOutput<typeof FrameMessage>

// Drop's runtimes mark every message they post; other scripts in the page post their own.
const Marked = v.object({ __drop: v.literal(true) })

/** The message, or null when it isn't one a drop frame sends. */
export function parseFrameMessage(data: unknown): FrameMessage | null {
  if (!v.is(Marked, data)) return null
  const result = v.safeParse(FrameMessage, data)
  return result.success ? result.output : null
}
