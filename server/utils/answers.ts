import { sql } from "drizzle-orm"
import { decodeHTMLAttribute } from "entities"
import { log } from "evlog"
import * as v from "valibot"
import { db } from "vite-hub/database/drizzle"
import { MAX_QUIZ_BLOCKS, QUIZ_KINDS, type QuizAnswerRequest, type QuizKind } from "#shared/quiz"
import type { DropQuiz, QuizAnswer, QuizResult } from "#shared/types"
import type { DropRow } from "./drops"
import type { Identity } from "./identity"

// What signed-in readers answered to a Markdown doc's questions, polls, and recall cards (#shared/quiz): one row per
// person and block, keyed on the doc's stable id so answers carry across versions, with the first answer kept beside
// the latest. Each isolate creates the table before its first write or a read that finds none, so neither production
// D1 nor Quiver needs a step of its own. The primary key serves the counts; the index serves a reader's own answers.
const TABLE = [
  "CREATE TABLE IF NOT EXISTS `drop_answers` (`link` text NOT NULL, `question` text NOT NULL, `user_id` text NOT NULL, `kind` text NOT NULL, `first_choice` text NOT NULL, `first_correct` integer, `choice` text NOT NULL, `correct` integer, `attempts` integer NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, PRIMARY KEY(`link`, `question`, `user_id`))",
  "CREATE INDEX IF NOT EXISTS `drop_answers_user_idx` ON `drop_answers` (`link`, `user_id`)",
  "CREATE TRIGGER IF NOT EXISTS `drop_answers_drop_delete` AFTER DELETE ON `drops` BEGIN DELETE FROM `drop_answers` WHERE `link` = OLD.id; END",
  "CREATE TRIGGER IF NOT EXISTS `drop_answers_user_delete` AFTER DELETE ON `user` BEGIN DELETE FROM `drop_answers` WHERE `user_id` = OLD.id; END",
]
// Added lazily to existing installations, just like the table itself. Each page has an independent action sequence.
const ORDER_COLUMNS = { first_session: "text", first_sequence: "integer", session: "text", sequence: "integer" }
let table: Promise<void> | undefined
function ensureTable() {
  table ??= (async () => {
    for (const statement of TABLE) await db.run(sql.raw(statement))
    const columns = await db.all<{ name: string }>(sql`PRAGMA table_info(drop_answers)`)
    for (const [name, type] of Object.entries(ORDER_COLUMNS)) {
      if (columns.some((column) => column.name === name)) continue
      try {
        await db.run(sql.raw(`ALTER TABLE drop_answers ADD COLUMN ${name} ${type}`))
      } catch (error) {
        // Another isolate may have added it since our PRAGMA read.
        if (!/duplicate column name/i.test(`${String(error)} ${error instanceof Error ? String(error.cause) : ""}`))
          throw error
      }
    }
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

/** Whether `who`'s answers on a drop count: a person signed in, in the browser, on a Markdown doc out of the Trash. */
export const answerable = (row: Pick<DropRow, "kind" | "expired">, who: Identity | null) =>
  who?.actorKind === "browser" && row.kind === "markdown" && !row.expired

/**
 * Keeps a reader's first and latest actions even when requests from a page arrive out of order. Separate page views
 * retain arrival order. A block the doc has no answers to yet counts against MAX_QUIZ_BLOCKS, checked in the same
 * statement; past it nothing is kept, and this returns false. Otherwise it returns the latest stored answer.
 */
export async function recordAnswer(link: string, userId: string, answer: QuizAnswerRequest, now = Date.now()) {
  await ensureTable()
  const choice = JSON.stringify(answer.choice)
  const correct = answer.correct === null ? null : Number(answer.correct)
  const session = answer.order?.session ?? null
  const sequence = answer.order?.sequence ?? null
  const first = sql`excluded.first_session IS NOT NULL AND excluded.first_session = first_session AND excluded.first_sequence < first_sequence`
  const latest = sql`excluded.session IS NULL OR session IS NULL OR excluded.session <> session OR excluded.sequence > sequence`
  const kept = await db.all<{ choice: string; correct: number | null }>(sql`INSERT INTO drop_answers
      (link, question, user_id, kind, first_choice, first_correct, choice, correct, attempts, created_at, updated_at,
       first_session, first_sequence, session, sequence)
    SELECT ${link}, ${answer.id}, ${userId}, ${answer.kind}, ${choice}, ${correct}, ${choice}, ${correct}, 1, ${now}, ${now},
      ${session}, ${sequence}, ${session}, ${sequence}
    WHERE EXISTS (SELECT 1 FROM drop_answers WHERE link = ${link} AND question = ${answer.id})
      OR (SELECT count(DISTINCT question) FROM drop_answers WHERE link = ${link}) < ${MAX_QUIZ_BLOCKS}
    ON CONFLICT (link, question, user_id) DO UPDATE SET
      first_choice = CASE WHEN ${first} THEN excluded.first_choice ELSE first_choice END,
      first_correct = CASE WHEN ${first} THEN excluded.first_correct ELSE first_correct END,
      first_sequence = CASE WHEN ${first} THEN excluded.first_sequence ELSE first_sequence END,
      kind = CASE WHEN ${latest} THEN excluded.kind ELSE kind END,
      choice = CASE WHEN ${latest} THEN excluded.choice ELSE choice END,
      correct = CASE WHEN ${latest} THEN excluded.correct ELSE correct END,
      updated_at = CASE WHEN ${latest} THEN excluded.updated_at ELSE updated_at END,
      session = CASE WHEN ${latest} THEN excluded.session ELSE session END,
      sequence = CASE WHEN ${latest} THEN excluded.sequence ELSE sequence END,
      attempts = attempts + 1
    RETURNING choice, correct`)
  const row = kept[0]
  return row ? { choice: v.parse(Keys, row.choice), correct: v.parse(Correct, row.correct) } : false
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
export async function quizOf(row: Pick<DropRow, "id">, userId: string): Promise<DropQuiz> {
  const link = row.id
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
 * its options with data-key and the right ones with data-correct. A block's options are between it and the next block.
 */
export function quizBlocks(html: string) {
  const blocks = new Map<string, { kind: string; keys: Set<string>; correct: Set<string> }>()
  const found = [...html.matchAll(/<[a-z][^>]*\sdata-quiz-id="([^"]*)"[^>]*>/gi)].slice(0, MAX_QUIZ_BLOCKS)
  for (const [index, match] of found.entries()) {
    const id = decodeHTMLAttribute(match[1]!)
    if (blocks.has(id)) continue
    const options = html.slice(match.index + match[0].length, found[index + 1]?.index ?? html.length)
    const keys = new Set<string>()
    const correct = new Set<string>()
    for (const option of options.matchAll(/<[a-z][^>]*\sdata-key="([^"]*)"[^>]*>/gi)) {
      const key = decodeHTMLAttribute(option[1]!)
      keys.add(key)
      if (/\sdata-correct(?=[\s=>])/.test(option[0])) correct.add(key)
    }
    blocks.set(id, {
      kind: decodeHTMLAttribute(/\sdata-quiz-kind="([^"]*)"/.exec(match[0])?.[1] ?? ""),
      keys,
      correct,
    })
  }
  return blocks
}
