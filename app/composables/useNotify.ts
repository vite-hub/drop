import type { QuotaFailure } from "#shared/quotas"

/** The plan-limit dialog's content (QuotaNotice), set when the server refuses a write for the plan's limits. */
export const useQuotaNotice = () => useState<QuotaFailure | null>("quota-notice", () => null)

/** A note in StatusNote: one line, with at most one action. `at` restarts it for the same words. */
export type StatusNote = { title: string; icon?: string; action?: { label: string; onClick: () => void }; at: number }
export const useStatusNote = () => useState<StatusNote | null>("status-note", () => null)

/**
 * Feedback with one voice. What went right is a one-line note in StatusNote that leaves on its own, with an action
 * when there's something to do about it (Undo, Open). What went wrong is a red toast with the server's own sentence,
 * which stays until it's read. A change the page already shows (a new row, a pin, a flipped switch, a check on the
 * copy button) gets neither.
 */
export function useNotify() {
  const toast = useToast()
  const note = useStatusNote()
  const quotaNotice = useQuotaNotice()
  /** The sentence to show beside the control that failed, or nothing when the plan-limit dialog says it instead. */
  function problem(error: unknown) {
    const body = quotaFailureOf(error)
    if (!body) return errorText(error)
    quotaNotice.value = body
    void refreshNuxtData(keys.usage)
  }
  const alert = (title: string, description?: string) =>
    toast.add({ title, description, color: "error", icon: "i-mingcute-warning-line", duration: 0 })
  const say = (title: string, options: Omit<StatusNote, "title" | "at"> = {}) =>
    (note.value = { title, ...options, at: Date.now() })
  return {
    say,
    done: (title: string) => say(title),
    alert,
    fail: (title: string, error: unknown) => {
      const description = problem(error)
      if (description) alert(title, description)
    },
    problem,
  }
}
