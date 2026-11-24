import * as v from "valibot"
import { MAX_QUIZ_BLOCKS, QuizAnswerInput, QuizId } from "./quiz"
import { InkSchema } from "./schemas"

const Rect = v.object({ left: v.number(), top: v.number(), right: v.number(), bottom: v.number() })
const path = { path: v.string() }

const MAX_VARIANTS = 100

const RuntimeErrorKind = v.picklist(["error", "rejection", "console", "load"])

export const FrameMessage = v.variant("type", [
  v.object({ type: v.literal("ready") }),
  v.object({ type: v.literal("navigate"), ...path }),
  v.object({ type: v.literal("host"), ...path }),
  v.object({ type: v.literal("location"), ...path }),
  v.object({ type: v.literal("frame-request"), id: v.string(), ...path }),
  v.object({ type: v.literal("page"), page: v.string(), html: v.optional(v.string()) }),
  v.object({ type: v.literal("copy"), text: v.string() }),
  v.object({ type: v.literal("heading"), id: v.pipe(v.string(), v.maxLength(300)), copy: v.optional(v.boolean()) }),
  v.object({ type: v.literal("doc-action"), action: v.picklist(["markdown", "download", "pdf"]) }),
  v.object({ type: v.literal("doc-open"), id: v.pipe(v.string(), v.regex(/^[\w-]{1,64}$/)) }),
  v.object({ type: v.literal("doc-intent") }),
  v.object({ type: v.literal("doc-copied"), ok: v.boolean(), error: v.optional(v.pipe(v.string(), v.maxLength(300))) }),
  v.object({ type: v.literal("doc-folder") }),
  v.object({ type: v.literal("activity") }),
  v.object({
    type: v.literal("pointer"),
    at: v.nullable(
      v.object({
        selector: v.pipe(v.string(), v.maxLength(1000)),
        x: v.pipe(v.number(), v.integer(), v.minValue(-1000), v.maxValue(2000)),
        y: v.pipe(v.number(), v.integer(), v.minValue(-1000), v.maxValue(2000)),
      }),
    ),
  }),
  v.object({ type: v.literal("files"), paths: v.pipe(v.array(v.string()), v.maxLength(100)) }),
  v.object({ type: v.literal("embeds"), links: v.pipe(v.array(v.string()), v.maxLength(20)) }),
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
  v.object({ type: v.literal("page-click") }),
  v.object({
    type: v.literal("draft-place"),
    rail: v.boolean(),
    pin: v.optional(v.literal(true)),
    id: v.optional(v.string()),
    rect: Rect,
  }),
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
    kind: v.optional(v.picklist(["area", "image"])),
    selector: v.string(),
    label: v.string(),
    ox: v.number(),
    oy: v.number(),
    ow: v.number(),
    oh: v.number(),
    rect: Rect,
    shot: v.optional(v.number()),
    quote: v.optional(v.pipe(v.string(), v.maxLength(2000))),
    ink: v.optional(v.fallback(v.nullable(InkSchema), null)),
  }),
  v.object({ type: v.literal("area-shot"), shot: v.number(), image: v.nullable(v.blob()) }),
  v.object({ type: v.literal("tool"), tool: v.picklist(["browse", "comment", "measure", "mark"]) }),
  v.object({ type: v.literal("marks"), count: v.pipe(v.number(), v.integer(), v.minValue(0)) }),
  v.object({ type: v.literal("mark-retry") }),
  v.object({
    type: v.literal("marker"),
    id: v.string(),
    clientX: v.number(),
    clientY: v.number(),
    focused: v.optional(v.boolean()),
  }),
  v.object({ type: v.literal("unplaced"), ids: v.array(v.string()) }),
  v.object({
    type: v.literal("key"),
    key: v.picklist([
      "Escape",
      "meta_k",
      "c",
      "e",
      "v",
      "r",
      "s",
      "u",
      "x",
      "b",
      "p",
      "a",
      "t",
      "z",
      "[",
      "]",
      "ArrowLeft",
      "ArrowRight",
    ]),
    tool: v.optional(v.picklist(["browse", "comment", "measure", "mark"])),
  }),
  v.object({
    type: v.literal("runtime-error"),
    kind: RuntimeErrorKind,
    message: v.string(),
    source: v.optional(v.string()),
  }),
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
      tool: v.optional(v.picklist(["move", "hand"])),
    }),
    v.check((message) => message.current < message.variants.length),
  ),
])

const QuizMessage = v.variant("type", [
  v.object({
    type: v.literal("comark-quiz:ready"),
    detail: v.object({
      ids: v.pipe(
        v.array(QuizId),
        v.transform((ids) => ids.slice(0, MAX_QUIZ_BLOCKS)),
      ),
    }),
  }),
  v.object({ type: v.literal("comark-quiz:answer"), detail: QuizAnswerInput }),
])

export type FrameMessage = v.InferOutput<typeof FrameMessage> | v.InferOutput<typeof QuizMessage>

const Marked = v.object({ __drop: v.literal(true) })

export function parseFrameMessage(data: unknown): FrameMessage | null {
  const result = v.is(Marked, data) ? v.safeParse(FrameMessage, data) : v.safeParse(QuizMessage, data)
  return result.success ? result.output : null
}

const ReviewScriptMessage = v.variant("type", [
  v.object({ __drop: v.literal(true), type: v.literal("review-ready") }),
  v.object({ __drop: v.literal(true), type: v.literal("key"), key: v.literal("meta_k") }),
])

export function parseReviewScriptMessage(data: unknown) {
  const result = v.safeParse(ReviewScriptMessage, data)
  return result.success ? result.output : null
}
