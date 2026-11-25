import type { QuotaFailure } from "#shared/quotas"
import type { EmbedCheck } from "~/utils/private-embeds"

export const useQuotaNotice = () => useState<QuotaFailure | null>("quota-notice", () => null)

export type StatusNote = { title: string; icon?: string; action?: { label: string; onClick: () => void }; at: number }
export const useStatusNote = () => useState<StatusNote | null>("status-note", () => null)

export function useNotify() {
  const toast = useToast()
  const note = useStatusNote()
  const quotaNotice = useQuotaNotice()
  function problem(error: unknown, title?: string) {
    reportClientError("notify", error, title ? { title } : {})
    const body = quotaFailureOf(error)
    if (!body) return errorText(error)
    quotaNotice.value = body
    void refreshNuxtData(keys.usage)
  }
  const alert = (title: string, description?: string) =>
    toast.add({ title, description, color: "error", icon: "i-mingcute-warning-line", duration: 0 })
  const say = (title: string, options: Omit<StatusNote, "title" | "at"> = {}) =>
    (note.value = { title, ...options, at: Date.now() })
  const privateEmbeds = (check: EmbedCheck) => {
    const notice = privateEmbedsNotice(check)
    if (!notice) return
    const { title, description } = notice
    toast.add({ title, description, color: "warning", icon: "i-mingcute-warning-line", duration: 12_000 })
  }
  return {
    say,
    privateEmbeds,
    done: (title: string) => say(title),
    alert,
    fail: (title: string, error: unknown) => {
      const description = problem(error, title)
      if (description) alert(title, description)
    },
    problem,
  }
}
