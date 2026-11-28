import * as v from "valibot"

export const MAX_QUIZ_BLOCKS = 200
const MAX_QUIZ_ID = 100
const MAX_QUIZ_KEY = 64
const MAX_QUIZ_CHOICES = 20
const MAX_QUIZ_NOTE = 2000

export const QUIZ_KINDS = ["question", "poll", "recall"] as const
export type QuizKind = (typeof QUIZ_KINDS)[number]

export const QuizId = v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_QUIZ_ID))

const keys = (least: number) =>
  v.pipe(
    v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_QUIZ_KEY))),
    v.minLength(least),
    v.maxLength(MAX_QUIZ_CHOICES),
    v.transform((list) => [...new Set(list)]),
  )
const correct = v.nullish(v.boolean(), null)

export const QuizAnswerInput = v.variant("kind", [
  v.object({ id: QuizId, kind: v.literal("question"), choice: keys(1), correct }),
  v.object({
    id: QuizId,
    kind: v.literal("poll"),
    choice: keys(0),
    correct,
    note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(MAX_QUIZ_NOTE))),
  }),
  v.object({
    id: QuizId,
    kind: v.literal("recall"),
    choice: v.strictTuple([v.picklist(["revealed", "knew", "missed"])]),
    correct,
  }),
])
export type QuizAnswerInput = v.InferOutput<typeof QuizAnswerInput>

export const QuizAnswerRequest = v.intersect([
  QuizAnswerInput,
  v.object({
    order: v.optional(
      v.object({
        session: v.pipe(v.string(), v.uuid()),
        sequence: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
        issuedAt: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(0))),
      }),
    ),
  }),
])
export type QuizAnswerRequest = v.InferOutput<typeof QuizAnswerRequest>
