import type { ReportSchema } from "#shared/schemas"
import type { InferInput } from "valibot"

// The calls the site review popups make (pages/review/*.vue), on Drop's origin with Drop's session.

/** The site drops that cover `origin` and that this person may comment on, each with the sealed choice to ask for its token. */
export const reviewSites = (origin: string) => $fetch("/api/review/sites", { method: "POST", body: { origin } })

export type ReviewSite = Awaited<ReturnType<typeof reviewSites>>["sites"][number]

/** A review token for the site drop picked, for `origin` only. Guests sign their comments with `name`. */
export const issueReviewToken = (body: { origin: string; choice: string; name?: string }) => $fetch("/api/review/token", { method: "POST", body })

export type ReviewToken = Awaited<ReturnType<typeof issueReviewToken>>

/** Where a review token's review opens, for people who could open it without the token. */
export const openReview = (token: string) => $fetch("/api/review/open", { method: "POST", body: { token } })

/** Sends a report to the instance operator. No sign-in needed. */
export const sendReport = (body: InferInput<typeof ReportSchema>) => $fetch("/api/reports", { method: "POST", body })
