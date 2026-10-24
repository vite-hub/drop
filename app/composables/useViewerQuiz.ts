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
  /** The blocks on the page, from the frame. */
  let shown: string[] = []
  watch(
    () => drop.value.link,
    () => {
      answers.clear()
      results.clear()
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
    const before = answers.get(answer.id) ?? drop.value.quiz?.answers[answer.id]
    answers.set(answer.id, { choice: answer.choice, correct: answer.correct })
    try {
      const saved = await $fetch<QuizSaved>(`/api/drops/${drop.value.id}/answers`, { method: "POST", body: answer })
      answers.set(answer.id, saved.answer)
      if (saved.results) results.set(answer.id, saved.results)
    } catch (error) {
      // A vote that wasn't saved doesn't show as one. A question still grades on the page.
      if (answer.kind === "poll") answers.set(answer.id, before ?? { choice: [], correct: null })
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
