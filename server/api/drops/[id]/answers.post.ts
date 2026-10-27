import { defineValidatedHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { MAX_QUIZ_BLOCKS, QuizAnswerRequest } from "#shared/quiz"
import type { QuizSaved } from "#shared/types"
import { answerable, quizBlocks, quizResults, recordAnswer } from "../../../utils/answers"
import { expiredLink, findDropAt, permissions, readText, waitingForReview } from "../../../utils/drops"
import { requireIdentity } from "../../../utils/identity"
import { renderMarkdownCached } from "../../../utils/markdown-document"
import { routeId } from "../../../utils/params"

/**
 * A reader's answer to a question, poll, or recall card in a Markdown doc. The viewer sends it for them: the doc's
 * frame can't reach Drop. Only people signed in answer here, with the access that opens the drop; a guest's answers
 * stay in their page (useViewerQuiz). The answer must name a block and options of the version they read, and comes
 * back with how everyone answered that block, which they may see now that they have.
 */
export default defineValidatedHandler({
  validate: { body: QuizAnswerRequest },
  async handler(event): Promise<QuizSaved> {
    const who = await requireIdentity(event)
    const version = Number(event.url.searchParams.get("v")) || undefined
    const drop = await findDropAt(await routeId(event), version, event)
    if (waitingForReview(drop, who))
      throw new HTTPError({ status: 403, statusText: "Waiting for review", data: { shareReview: "pending" } })
    if (expiredLink(drop, who))
      throw new HTTPError({ status: 410, statusText: "This drop expired after nobody opened it for a while." })
    if (!drop || !permissions(drop, who).view)
      throw new HTTPError({ status: 404, statusText: "This drop is private, or it was deleted." })
    if (!answerable(drop, who) || !drop.blobKey)
      throw new HTTPError({ status: 403, statusText: "Only people answer, on a Markdown doc that isn't in the Trash." })
    await requireRateLimit(event, "quiz-answer", { key: `${drop.id}:${who.userId}`, limit: 30, window: "1m" })
    const answer = await event.req.json()
    const key = drop.blobKey
    const block = quizBlocks((await renderMarkdownCached(key, () => readText(key), event)).html).get(answer.id)
    if (
      block?.kind !== answer.kind ||
      (answer.kind !== "recall" && answer.choice.some((option) => !block.keys.has(option)))
    )
      throw new HTTPError({ status: 400, statusText: "That isn't a block of this doc, or one of its options." })
    // Match comark-quiz's exact-set grading. Recall self-assessment lives in choice, never in correct.
    answer.correct =
      answer.kind === "question"
        ? answer.choice.length === block.correct.size && answer.choice.every((option) => block.correct.has(option))
        : null
    const link = drop.id
    const kept = await recordAnswer(link, who.userId, answer)
    if (!kept)
      throw new HTTPError({ status: 409, statusText: `A doc keeps answers to ${MAX_QUIZ_BLOCKS} blocks at most.` })
    if (answer.kind === "recall") return { answer: kept }
    const { counts, total } = (await quizResults(link, { question: answer.id })).get(answer.id) ?? {
      counts: {},
      total: 0,
    }
    return { answer: kept, results: { counts, total } }
  },
})
