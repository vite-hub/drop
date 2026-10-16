import type { QuotaFailure } from "#shared/quotas"

/** The plan-limit dialog's content (QuotaNotice), set when the server refuses a write for the plan's limits. */
export const useQuotaNotice = () => useState<QuotaFailure | null>("quota-notice", () => null)

/** Toasts with one voice: successes are neutral, failures are red and carry the server's own sentence. */
export function useNotify() {
  const toast = useToast()
  const quotaNotice = useQuotaNotice()
  return {
    done: (title: string, description?: string) => toast.add({ title, description, icon: "i-lucide-check" }),
    fail: (title: string, error: unknown) => {
      const body = (error as { data?: QuotaFailure })?.data
      if (body?.code === "DROP_LIMIT_REACHED") {
        quotaNotice.value = body
        void refreshNuxtData("usage")
        return
      }
      toast.add({ title, description: errorText(error), color: "error", icon: "i-lucide-circle-alert" })
    },
    info: toast.add,
  }
}
