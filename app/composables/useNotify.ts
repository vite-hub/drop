import type { QuotaFailure } from "#shared/quotas"

/** The plan-limit dialog's content (QuotaNotice), set when the server refuses a write for the plan's limits. */
export const useQuotaNotice = () => useState<QuotaFailure | null>("quota-notice", () => null)

/**
 * Toasts with one voice: successes are neutral, failures are red and carry the server's own sentence. A toast is for
 * what has no place on screen: a failure away from its control, an undo, news from someone else. A change the page
 * already shows (a new pin, a flipped switch, a check on the copy button) doesn't get one.
 */
export function useNotify() {
  const toast = useToast()
  const quotaNotice = useQuotaNotice()
  /** The sentence to show beside the control that failed, or nothing when the plan-limit dialog says it instead. */
  function problem(error: unknown) {
    const body = quotaFailureOf(error)
    if (!body) return errorText(error)
    quotaNotice.value = body
    void refreshNuxtData(keys.usage)
  }
  return {
    done: (title: string, description?: string) => toast.add({ title, description, icon: "i-ph-check" }),
    fail: (title: string, error: unknown) => {
      const description = problem(error)
      if (description) toast.add({ title, description, color: "error", icon: "i-ph-warning-circle" })
    },
    problem,
    info: toast.add,
  }
}
