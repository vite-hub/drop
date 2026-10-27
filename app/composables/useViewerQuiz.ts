import type { FrameMessage } from "#shared/frame-messages"
import type { DropDetail, QuizAnswer, QuizResult, QuizSaved } from "#shared/types"

type QuizMessage = Extract<FrameMessage, { type: "quiz-ready" | "quiz-answer" }>

/**
 * A Markdown doc's questions, polls, and recall cards (comark-quiz), over the frame's bridge (QUIZ_BRIDGE). The frame
 * can't reach Drop's API, so the viewer keeps the answers. A reader whose answers count (the drop's `quiz`) saves each
 * one and gets back how everyone answered that block; a guest's answers last the page view, so questions still grade,
 * and polls ask them to sign in to vote.
 */
export function useViewerQuiz(drop: Ref<DropDetail>, send: (message: Record<string, unknown>) => void) {
  const notify = useNotify()
  // This page view's answers and the results they brought back, over the ones the drop came with. Maps: ids and keys
  // come from the doc, and `__proto__` must stay an ordinary key.
  const answers = new Map<string, QuizAnswer>()
  const results = new Map<string, QuizResult>()
  const sequences = new Map<string, number>()
  const confirmed = new Map<string, { sequence: number; saved: QuizSaved }>()
  const failedPolls = new Set<string>()
  let issuedAt = 0
  let session = crypto.randomUUID()
  /** The blocks on the page, from the frame. */
  let shown: string[] = []
  watch(
    () => drop.value.link,
    () => {
      answers.clear()
      results.clear()
      sequences.clear()
      confirmed.clear()
      failedPolls.clear()
      session = crypto.randomUUID()
    },
  )

  function push() {
    const saved = drop.value.quiz
    const answer = (id: string) => answers.get(id) ?? saved?.answers[id]
    const result = (id: string) => results.get(id) ?? saved?.results[id]
    // Fresh objects: postMessage can't copy a reactive proxy.
    send({
      type: "quiz-state",
      state: {
        answers: Object.fromEntries(
          shown.flatMap((id) => {
            const value = answer(id)
            return value ? [[id, { choice: [...value.choice], correct: value.correct }]] : []
          }),
        ),
        results: Object.fromEntries(
          shown.flatMap((id) => {
            const value = result(id)
            return value ? [[id, { counts: { ...value.counts }, total: value.total }]] : []
          }),
        ),
        voting: saved
          ? { open: true }
          : {
              open: false,
              notice: drop.value.trashedAt === null ? "Sign in to vote" : "Voting is closed in the Trash",
            },
      },
    })
  }

  async function save(answer: Extract<QuizMessage, { type: "quiz-answer" }>["answer"]) {
    const before = drop.value.quiz?.answers[answer.id]
    const sequence = (sequences.get(answer.id) ?? 0) + 1
    sequences.set(answer.id, sequence)
    // Epoch microseconds compare actions across tabs; the sequence also orders actions within one page.
    issuedAt = Math.max(issuedAt + 1, Math.round((performance.timeOrigin + performance.now()) * 1000))
    const order = { session, sequence, issuedAt }
    const current = () => session === order.session && sequences.get(answer.id) === sequence
    failedPolls.delete(answer.id)
    answers.set(answer.id, { choice: answer.choice, correct: answer.correct })
    try {
      const saved = await $fetch<QuizSaved>(`/api/drops/${drop.value.id}/answers`, {
        method: "POST",
        query: { v: drop.value.version },
        body: { ...answer, order },
      })
      if (session !== order.session) return
      if (sequence <= (confirmed.get(answer.id)?.sequence ?? 0)) return
      confirmed.set(answer.id, { sequence, saved })
      // A failed newest vote rolls back to the latest success, even if that success finishes later.
      if (!current() && !failedPolls.has(answer.id)) return
      answers.set(answer.id, saved.answer)
      if (saved.results) results.set(answer.id, saved.results)
      else results.delete(answer.id)
    } catch (error) {
      if (!current()) return
      // A vote that wasn't saved doesn't show as one. A question still grades on the page.
      if (answer.kind === "poll") {
        failedPolls.add(answer.id)
        const saved = confirmed.get(answer.id)?.saved
        answers.set(answer.id, saved?.answer ?? before ?? { choice: [], correct: null })
        if (saved?.results) results.set(answer.id, saved.results)
        else results.delete(answer.id)
      }
      notify.fail("Couldn't save your answer", error)
    }
    push()
  }

  function receive(message: QuizMessage) {
    if (message.type === "quiz-ready") {
      shown = message.ids
      return push()
    }
    const { answer } = message
    if (drop.value.quiz) return void save(answer)
    if (answer.kind !== "poll") answers.set(answer.id, { choice: answer.choice, correct: answer.correct })
    push()
  }

  return { receive }
}
