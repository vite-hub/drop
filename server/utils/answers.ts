import { sql } from "drizzle-orm"
import { decodeHTMLAttribute } from "entities"
import { log } from "evlog"
import * as v from "valibot"
import { db } from "vite-hub/database/drizzle"
import { MAX_QUIZ_BLOCKS, QUIZ_KINDS, type QuizAnswerInput, type QuizKind } from "#shared/quiz"
import type { DropQuiz, QuizAnswer, QuizResult } from "#shared/types"
import type { DropRow } from "./drops"
import type { Identity } from "./identity"

// What signed-in readers answered to a Markdown doc's questions, polls, and recall cards (#shared/quiz): one row per
// person and block, keyed on the doc's link so answers carry across versions, with the first answer kept beside the
// latest. Like drop_resources, each isolate creates the table before its first write or a read that finds none, so
// neither production D1 nor Quiver needs a step of its own. The primary key serves the counts; the index serves a
// reader's own answers.
const TABLE = [
  "CREATE TABLE IF NOT EXISTS `drop_answers` (`link` text NOT NULL, `question` text NOT NULL, `user_id` text NOT NULL, `kind` text NOT NULL, `first_choice` text NOT NULL, `first_correct` integer, `choice` text NOT NULL, `correct` integer, `attempts` integer NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, PRIMARY KEY(`link`, `question`, `user_id`))",
  "CREATE INDEX IF NOT EXISTS `drop_answers_user_idx` ON `drop_answers` (`link`, `user_id`)",
  "CREATE TRIGGER IF NOT EXISTS `drop_answers_drop_delete` AFTER DELETE ON `drops` WHEN NOT EXISTS (SELECT 1 FROM drops d WHERE d.link = OLD.link) BEGIN DELETE FROM `drop_answers` WHERE `link` = coalesce(OLD.link, OLD.id); END",
  "CREATE TRIGGER IF NOT EXISTS `drop_answers_user_delete` AFTER DELETE ON `user` BEGIN DELETE FROM `drop_answers` WHERE `user_id` = OLD.id; END",
]
let table: Promise<void> | undefined
function ensureTable() {
  table ??= (async () => {
    for (const statement of TABLE) await db.run(sql.raw(statement))
  })().catch((error: unknown) => {
    table = undefined
    throw error
  })
  return table
}

/** A read doesn't wait for the table's statements: it creates the table only when it finds none. */
const reading = <T>(read: () => Promise<T>) =>
  read().catch(async (error: unknown) => {
    // Drizzle wraps the database's error, which names the missing table, as its cause.
    if (!/no such table/i.test(`${String(error)} ${error instanceof Error ? String(error.cause) : ""}`)) throw error
    await ensureTable()
    return read()
  })

type Linked = Pick<DropRow, "id" | "link">

/** Whether `who`'s answers on a drop count: a person signed in, in the browser, on a Markdown doc out of the Trash. */
export const answerable = (row: Pick<DropRow, "kind" | "expired">, who: Identity | null) =>
  who?.actorKind === "browser" && row.kind === "markdown" && !row.expired

/**
 * Keeps a reader's answer: their first stays as it was, and this one becomes their latest. A block the doc has no
 * answers to yet counts against MAX_QUIZ_BLOCKS, checked in the same statement; past it nothing is kept, and this
 * returns false.
 */
export async function recordAnswer(link: string, userId: string, answer: QuizAnswerInput, now = Date.now()) {
  await ensureTable()
  const choice = JSON.stringify(answer.choice)
  const correct = answer.correct === null ? null : Number(answer.correct)
  const kept = await db.all<{ attempts: number }>(sql`INSERT INTO drop_answers
      (link, question, user_id, kind, first_choice, first_correct, choice, correct, attempts, created_at, updated_at)
    SELECT ${link}, ${answer.id}, ${userId}, ${answer.kind}, ${choice}, ${correct}, ${choice}, ${correct}, 1, ${now}, ${now}
    WHERE EXISTS (SELECT 1 FROM drop_answers WHERE link = ${link} AND question = ${answer.id})
      OR (SELECT count(DISTINCT question) FROM drop_answers WHERE link = ${link}) < ${MAX_QUIZ_BLOCKS}
    ON CONFLICT (link, question, user_id) DO UPDATE SET kind = excluded.kind, choice = excluded.choice,
      correct = excluded.correct, attempts = attempts + 1, updated_at = excluded.updated_at
    RETURNING attempts`)
  return kept.length > 0
}

const Keys = v.pipe(v.string(), v.parseJson(), v.array(v.string()))
const Correct = v.pipe(
  v.nullable(v.number()),
  v.transform((value) => (value === null ? null : value === 1)),
)
const AnswerRow = v.object({
  question: v.string(),
  kind: v.picklist(QUIZ_KINDS),
  first_choice: Keys,
  first_correct: Correct,
  choice: Keys,
  correct: Correct,
  attempts: v.number(),
  updated_at: v.number(),
})

/** One reader's answer to a block: their first and their latest. */
export interface StoredAnswer {
  id: string
  kind: QuizKind
  first: QuizAnswer
  latest: QuizAnswer
  attempts: number
  answeredAt: number
}

/** Everything one reader answered on a doc, in the order they first did. */
export async function answersOf(link: string, userId: string): Promise<StoredAnswer[]> {
  const rows = await reading(() =>
    db.all(sql`SELECT question, kind, first_choice, first_correct, choice, correct, attempts, updated_at
      FROM drop_answers WHERE link = ${link} AND user_id = ${userId} ORDER BY created_at, question`),
  )
  return rows.map((row) => {
    const answer = v.parse(AnswerRow, row)
    return {
      id: answer.question,
      kind: answer.kind,
      first: { choice: answer.first_choice, correct: answer.first_correct },
      latest: { choice: answer.choice, correct: answer.correct },
      attempts: answer.attempts,
      answeredAt: answer.updated_at,
    }
  })
}

/** A block's results, with whether it's a question or a poll. */
export type QuizTally = QuizResult & { kind: Exclude<QuizKind, "recall"> }

/**
 * How everyone answered a doc's questions and polls: each person once, by their first try at a question and their
 * current vote in a poll. Recall cards don't count. `answeredBy` keeps the blocks one reader answered, `question` one
 * block.
 */
export async function quizResults(
  link: string,
  among: { answeredBy?: string; question?: string } = {},
): Promise<Map<string, QuizTally>> {
  const only =
    among.question !== undefined
      ? sql` AND a.question = ${among.question}`
      : among.answeredBy !== undefined
        ? sql` AND a.question IN (SELECT question FROM drop_answers WHERE link = ${link} AND user_id = ${among.answeredBy})`
        : sql``
  const counted = sql`CASE a.kind WHEN 'poll' THEN a.choice ELSE a.first_choice END`
  // A row per block and option, and one per block (option null) with how many people it counts.
  const rows = await reading(() =>
    db.all<{ question: string; option: string | null; people: number; kind: string | null }>(sql`
      SELECT a.question, o.value AS option, count(*) AS people, NULL AS kind
      FROM drop_answers a, json_each(${counted}) o
      WHERE a.link = ${link} AND a.kind <> 'recall'${only}
      GROUP BY a.question, o.value
      UNION ALL
      SELECT a.question, NULL, count(*), max(a.kind) FROM drop_answers a
      WHERE a.link = ${link} AND a.kind <> 'recall' AND ${counted} <> '[]'${only}
      GROUP BY a.question`),
  )
  // Maps, then Object.fromEntries: ids and keys come from the doc, and `__proto__` must stay an ordinary key.
  const tallies = new Map<string, { kind: QuizTally["kind"]; counts: Map<string, number>; total: number }>()
  for (const row of rows) {
    let tally = tallies.get(row.question)
    if (!tally) tallies.set(row.question, (tally = { kind: "question", counts: new Map(), total: 0 }))
    if (row.option === null) {
      tally.total = row.people
      tally.kind = row.kind === "poll" ? "poll" : "question"
    } else tally.counts.set(row.option, row.people)
  }
  return new Map(
    [...tallies].map(([id, { kind, counts, total }]) => [id, { kind, counts: Object.fromEntries(counts), total }]),
  )
}

/** The reader's side of a doc's blocks, for its page: their answers, and results for the ones they answered. */
export async function quizOf(row: Linked, userId: string): Promise<DropQuiz> {
  const link = row.link ?? row.id
  try {
    const [mine, results] = await Promise.all([answersOf(link, userId), quizResults(link, { answeredBy: userId })])
    return {
      answers: Object.fromEntries(mine.map((answer) => [answer.id, answer.latest])),
      results: Object.fromEntries([...results].map(([id, { counts, total }]) => [id, { counts, total }])),
    }
  } catch (error) {
    // The page still opens, and an answer still saves.
    log.error({ action: "drop-answers", error: String(error) })
    return { answers: {}, results: {} }
  }
}

/**
 * The blocks a rendered doc holds, in order: comark-quiz marks each with data-quiz-id and data-quiz-kind, and each of
 * its options with data-key. A block's options are the keys between it and the next block.
 */
export function quizBlocks(html: string) {
  const blocks = new Map<string, { kind: string; keys: Set<string> }>()
  const found = [...html.matchAll(/<[a-z][^>]*\sdata-quiz-id="([^"]*)"[^>]*>/gi)].slice(0, MAX_QUIZ_BLOCKS)
  for (const [index, match] of found.entries()) {
    const id = decodeHTMLAttribute(match[1]!)
    if (blocks.has(id)) continue
    const options = html.slice(match.index + match[0].length, found[index + 1]?.index ?? html.length)
    blocks.set(id, {
      kind: decodeHTMLAttribute(/\sdata-quiz-kind="([^"]*)"/.exec(match[0])?.[1] ?? ""),
      keys: new Set(Array.from(options.matchAll(/\sdata-key="([^"]*)"/g), (key) => decodeHTMLAttribute(key[1]!))),
    })
  }
  return blocks
}
