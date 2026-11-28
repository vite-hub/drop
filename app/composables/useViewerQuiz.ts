import type { FrameMessage } from "#shared/frame-messages"
import type { DropDetail, QuizAnswer, QuizResult, QuizSaved } from "#shared/types"

type QuizMessage = Extract<FrameMessage, { type: "comark-quiz:ready" | "comark-quiz:answer" }>

export function useViewerQuiz(drop: Ref<DropDetail>, send: (message: Record<string, unknown>) => void) {
  const notify = useNotify()
  const answers = new Map<string, QuizAnswer>()
  const results = new Map<string, QuizResult>()
  const sequences = new Map<string, number>()
  const confirmed = new Map<string, { sequence: number; saved: QuizSaved }>()
  const pendingNotes = new Map<string, Promise<void>>()
  const failedPolls = new Set<string>()
  let issuedAt = 0
  let session = crypto.randomUUID()
  let shown: string[] = []
  watch(
    () => drop.value.link,
    () => {
      answers.clear()
      results.clear()
      sequences.clear()
      confirmed.clear()
      pendingNotes.clear()
      failedPolls.clear()
      session = crypto.randomUUID()
    },
  )

  function push() {
    const saved = drop.value.quiz
    const answer = (id: string) => answers.get(id) ?? saved?.answers[id]
    const result = (id: string) => results.get(id) ?? saved?.results[id]
    send({
      type: "comark-quiz:state",
      detail: {
        answers: Object.fromEntries(
          shown.flatMap((id) => {
            const value = answer(id)
            if (!value) return []
            const { choice, correct, note } = value
            return [[id, { choice: [...choice], correct, ...(note === undefined ? {} : { note }) }]]
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

  async function save(answer: Extract<QuizMessage, { type: "comark-quiz:answer" }>["detail"]) {
    const { id: dropId, version } = drop.value
    const before = drop.value.quiz?.answers[answer.id]
    const sequence = (sequences.get(answer.id) ?? 0) + 1
    sequences.set(answer.id, sequence)
    issuedAt = Math.max(issuedAt + 1, Math.round((performance.timeOrigin + performance.now()) * 1000))
    const order = { session, sequence, issuedAt }
    const current = () => session === order.session && sequences.get(answer.id) === sequence
    failedPolls.delete(answer.id)
    answers.set(answer.id, shownAnswer(answer))
    try {
      const pendingNote = pendingNotes.get(answer.id)
      if (pendingNote) await pendingNote
      if (session !== order.session) return
      const saved = await $fetch<QuizSaved>(`/api/drops/${dropId}/answers`, {
        method: "POST",
        query: { v: version },
        body: { ...answer, order },
      })
      if (session !== order.session) return
      if (sequence <= (confirmed.get(answer.id)?.sequence ?? 0)) return
      confirmed.set(answer.id, { sequence, saved })
      if (!current() && !failedPolls.has(answer.id)) return
      answers.set(answer.id, saved.answer)
      if (saved.results) results.set(answer.id, saved.results)
      else results.delete(answer.id)
    } catch (error) {
      if (!current()) return
      if (answer.kind === "poll") {
        failedPolls.add(answer.id)
        const saved = confirmed.get(answer.id)?.saved
        answers.set(
          answer.id,
          saved?.answer ?? before ?? { choice: [], correct: null, ...(answer.note === undefined ? {} : { note: "" }) },
        )
        if (saved?.results) results.set(answer.id, saved.results)
        else results.delete(answer.id)
      }
      notify.fail("Couldn't save your answer", error)
    }
    push()
  }

  function receive(message: QuizMessage) {
    if (message.type === "comark-quiz:ready") {
      shown = message.detail.ids
      return push()
    }
    const answer = message.detail
    if (drop.value.quiz) {
      const saving = save(answer)
      if (answer.kind === "poll" && answer.note !== undefined) {
        pendingNotes.set(answer.id, saving)
        void saving.finally(() => {
          if (pendingNotes.get(answer.id) === saving) pendingNotes.delete(answer.id)
        })
      }
      return
    }
    if (answer.kind !== "poll") answers.set(answer.id, { choice: answer.choice, correct: answer.correct })
    push()
  }

  return { receive }
}

const shownAnswer = (answer: Extract<QuizMessage, { type: "comark-quiz:answer" }>["detail"]): QuizAnswer => ({
  choice: answer.choice,
  correct: answer.correct,
  ...(answer.kind === "poll" && answer.note !== undefined ? { note: answer.note } : {}),
})
