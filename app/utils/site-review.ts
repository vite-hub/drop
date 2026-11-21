import type { ReportSchema } from "#shared/schemas"
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
