// Questions, polls, and recall cards in Markdown docs (comark-quiz's ::question, ::poll, ::recall). Each block has an
// id and its options a key (`data-quiz-id`, `data-key`); its script reports answers to Drop through the frame
// (QUIZ_BRIDGE in ./plan-runtime), and Drop keeps the ones signed-in readers give (server/utils/answers.ts).
import * as v from "valibot"

/** How many blocks of one doc keep answers, across its versions. */
export const MAX_QUIZ_BLOCKS = 200
const MAX_QUIZ_ID = 100
const MAX_QUIZ_KEY = 64
/** How many options one answer picks. */
const MAX_QUIZ_CHOICES = 20

export const QUIZ_KINDS = ["question", "poll", "recall"] as const
export type QuizKind = (typeof QUIZ_KINDS)[number]

export const QuizId = v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_QUIZ_ID))

/** Option keys, each once. */
const keys = (least: number) =>
  v.pipe(
    v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_QUIZ_KEY))),
    v.minLength(least),
    v.maxLength(MAX_QUIZ_CHOICES),
    v.transform((list) => [...new Set(list)]),
  )
const correct = v.nullish(v.boolean(), null)

/**
 * One answer, as comark-quiz reports it: the options picked for a question, the vote for a poll (none takes it back),
 * and how a recall card went. The server regrades questions from the rendered options; polls and recall cards have
 * no correctness (a recall card's choice records its self-assessment).
 */
export const QuizAnswerInput = v.variant("kind", [
  v.object({ id: QuizId, kind: v.literal("question"), choice: keys(1), correct }),
  v.object({ id: QuizId, kind: v.literal("poll"), choice: keys(0), correct }),
  v.object({
    id: QuizId,
    kind: v.literal("recall"),
    choice: v.strictTuple([v.picklist(["revealed", "knew", "missed"])]),
    correct,
  }),
])
export type QuizAnswerInput = v.InferOutput<typeof QuizAnswerInput>

/** Browser action order across page views; optional for clients using the original answer API. */
export const QuizAnswerRequest = v.intersect([
  QuizAnswerInput,
  v.object({
    order: v.optional(
      v.object({
        session: v.pipe(v.string(), v.uuid()),
        sequence: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
        /** Epoch microseconds, capped at server receipt time; older clients only supplied a session and sequence. */
        issuedAt: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(0))),
      }),
    ),
  }),
])
export type QuizAnswerRequest = v.InferOutput<typeof QuizAnswerRequest>
