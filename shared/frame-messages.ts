import * as v from "valibot"

// What a drop's frame posts up to the viewer: the comment layer (shared/plan-runtime.ts), an app's page runtime
// (shared/project-bundle.ts), and the content origin's frame host (server/utils/content-origin.ts). Frames run the
// drop's own code, which can post anything, so the viewer parses each message here and drops what doesn't fit.

const Rect = v.object({ left: v.number(), top: v.number(), right: v.number(), bottom: v.number() })
const path = { path: v.string() }

const RuntimeErrorKind = v.picklist(["error", "rejection", "console", "load"])

export const FrameMessage = v.variant("type", [
  v.object({ type: v.literal("ready") }),
  v.object({ type: v.literal("navigate"), ...path }),
  v.object({ type: v.literal("host"), ...path }),
  v.object({ type: v.literal("location"), ...path }),
  v.object({ type: v.literal("frame-request"), id: v.string(), ...path }),
  v.object({ type: v.literal("copy"), text: v.string() }),
  // The /f/ paths of a Markdown doc's images that came near the screen (DEFERRED_IMAGES_SCRIPT in ./documents).
  v.object({ type: v.literal("images"), paths: v.pipe(v.array(v.string()), v.maxLength(100)) }),
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
  }),
  v.object({ type: v.literal("marker"), id: v.string(), clientX: v.number(), clientY: v.number() }),
  v.object({ type: v.literal("unplaced"), ids: v.array(v.string()) }),
  v.object({ type: v.literal("key"), key: v.picklist(["Escape", "r"]) }),
  v.object({
    type: v.literal("runtime-error"),
    kind: RuntimeErrorKind,
    message: v.string(),
    source: v.optional(v.string()),
  }),
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
