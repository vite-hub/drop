import { feedbackPromptTarget, promptMarkdown, waitingForAnswer } from "#shared/feedback"
import { dropPath } from "#shared/links"
import type { ReportSchema } from "#shared/schemas"
import type { DropComment, DropDetail } from "#shared/types"
import type { InferInput } from "valibot"

export const reviewSites = (origin: string) => $fetch("/api/review/sites", { method: "POST", body: { origin } })

export type ReviewSite = Awaited<ReturnType<typeof reviewSites>>["sites"][number]

export const startSiteReview = (origin: string) => $fetch("/api/sites", { method: "POST", body: { url: origin } })

export const issueReviewToken = (body: { origin: string; choice: string; name?: string }) =>
  $fetch("/api/review/token", { method: "POST", body })

export type ReviewToken = Awaited<ReturnType<typeof issueReviewToken>>

export const openReview = (body: { token: string } | { doc: string }) =>
  $fetch("/api/review/open", { method: "POST", body })

export const sendReport = (body: InferInput<typeof ReportSchema>) => $fetch("/api/reports", { method: "POST", body })

export async function reviewPrompt(id: string, me: string) {
  const [drop, comments] = await Promise.all([
    $fetch<DropDetail>(`/api/drops/${id}`),
    $fetch<DropComment[]>(`/api/drops/${id}/comments`),
  ])
  const waiting = waitingForAnswer(comments, { me })
  if (!waiting.length) return null
  const target = feedbackPromptTarget(drop, new URL(dropPath(drop), location.origin).href)
  return promptMarkdown(target.drop, target.url, waiting)
}
