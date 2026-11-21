import { sql } from "drizzle-orm"
import { decodeHTMLAttribute } from "entities"
import * as v from "valibot"
import { db } from "vite-hub/database"
import { MAX_QUIZ_BLOCKS, QUIZ_KINDS, type QuizAnswerRequest, type QuizKind } from "#shared/quiz"
import type { DropQuiz, QuizAnswer, QuizResult } from "#shared/types"
import type { H3Event } from "h3"
import type { DropRow } from "./drops"
import type { Identity } from "./identity"
import { logError } from "./logs"

const TABLE = [
  "CREATE TABLE IF NOT EXISTS `drop_answers` (`link` text NOT NULL, `question` text NOT NULL, `user_id` text NOT NULL, `kind` text NOT NULL, `first_choice` text NOT NULL, `first_correct` integer, `choice` text NOT NULL, `correct` integer, `attempts` integer NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, PRIMARY KEY(`link`, `question`, `user_id`))",
  "CREATE INDEX IF NOT EXISTS `drop_answers_user_idx` ON `drop_answers` (`link`, `user_id`)",
  "CREATE TRIGGER IF NOT EXISTS `drop_answers_drop_delete` AFTER DELETE ON `drops` BEGIN DELETE FROM `drop_answers` WHERE `link` = OLD.id; END",
  "CREATE TRIGGER IF NOT EXISTS `drop_answers_user_delete` AFTER DELETE ON `user` BEGIN DELETE FROM `drop_answers` WHERE `user_id` = OLD.id; END",
]
const ORDER_COLUMNS = {
  first_session: "text",
  first_sequence: "integer",
  session: "text",
  sequence: "integer",
  first_issued_at: "integer",
  issued_at: "integer",
}
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

const reading = <T>(read: () => Promise<T>) =>
  read().catch(async (error: unknown) => {
    if (!/no such table/i.test(`${String(error)} ${error instanceof Error ? String(error.cause) : ""}`)) throw error
    await ensureTable()
    return read()
  })

export const answerable = (row: Pick<DropRow, "kind" | "expired">, who: Identity | null) =>
  who?.actorKind === "browser" && row.kind === "markdown" && !row.expired

export async function recordAnswer(link: string, userId: string, answer: QuizAnswerRequest, now = Date.now()) {
  await ensureTable()
  const choice = JSON.stringify(answer.choice)
  const correct = answer.correct === null ? null : Number(answer.correct)
  const session = answer.order?.session ?? null
  const sequence = answer.order?.sequence ?? null
  const issuedAt = answer.order?.issuedAt === undefined ? null : Math.min(answer.order.issuedAt, (now + 1) * 1000 - 1)
  const previousFirstIssuedAt = sql`min(first_issued_at, (created_at + 1) * 1000 - 1)`
  const previousIssuedAt = sql`min(issued_at, (updated_at + 1) * 1000 - 1)`
  const first = sql`(excluded.first_session = first_session AND excluded.first_sequence < first_sequence)
    OR (excluded.first_session <> first_session AND (excluded.first_issued_at < ${previousFirstIssuedAt}
      OR (excluded.first_issued_at = ${previousFirstIssuedAt} AND excluded.first_session < first_session)))`
  const latest = sql`CASE
    WHEN excluded.session = session THEN excluded.sequence > sequence
    WHEN excluded.issued_at IS NOT NULL THEN issued_at IS NULL OR excluded.issued_at > ${previousIssuedAt}
      OR (excluded.issued_at = ${previousIssuedAt} AND excluded.session > session)
    WHEN excluded.session IS NOT NULL THEN issued_at IS NULL
    ELSE session IS NULL END`
  const kept = await db.all<{ choice: string; correct: number | null }>(sql`INSERT INTO drop_answers
      (link, question, user_id, kind, first_choice, first_correct, choice, correct, attempts, created_at, updated_at,
       first_session, first_sequence, session, sequence, first_issued_at, issued_at)
    SELECT ${link}, ${answer.id}, ${userId}, ${answer.kind}, ${choice}, ${correct}, ${choice}, ${correct}, 1, ${now}, ${now},
      ${session}, ${sequence}, ${session}, ${sequence}, ${issuedAt}, ${issuedAt}
    WHERE EXISTS (SELECT 1 FROM drop_answers WHERE link = ${link} AND question = ${answer.id})
      OR (SELECT count(DISTINCT question) FROM drop_answers WHERE link = ${link}) < ${MAX_QUIZ_BLOCKS}
    ON CONFLICT (link, question, user_id) DO UPDATE SET
      first_choice = CASE WHEN ${first} THEN excluded.first_choice ELSE first_choice END,
      first_correct = CASE WHEN ${first} THEN excluded.first_correct ELSE first_correct END,
      first_session = CASE WHEN ${first} THEN excluded.first_session ELSE first_session END,
      first_sequence = CASE WHEN ${first} THEN excluded.first_sequence ELSE first_sequence END,
      first_issued_at = CASE WHEN ${first} THEN COALESCE(excluded.first_issued_at, first_issued_at) ELSE first_issued_at END,
      kind = CASE WHEN ${latest} THEN excluded.kind ELSE kind END,
      choice = CASE WHEN ${latest} THEN excluded.choice ELSE choice END,
      correct = CASE WHEN ${latest} THEN excluded.correct ELSE correct END,
      updated_at = CASE WHEN ${latest} THEN excluded.updated_at ELSE updated_at END,
      session = CASE WHEN ${latest} THEN excluded.session ELSE session END,
      sequence = CASE WHEN ${latest} THEN excluded.sequence ELSE sequence END,
      issued_at = CASE WHEN ${latest} THEN COALESCE(excluded.issued_at, issued_at) ELSE issued_at END,
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

export interface StoredAnswer {
  id: string
  kind: QuizKind
  first: QuizAnswer
  latest: QuizAnswer
  attempts: number
  answeredAt: number
}

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

export type QuizTally = QuizResult & { kind: Exclude<QuizKind, "recall"> }

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

export async function quizOf(row: Pick<DropRow, "id">, userId: string, event?: H3Event): Promise<DropQuiz> {
  const link = row.id
  try {
    const [mine, results] = await Promise.all([answersOf(link, userId), quizResults(link, { answeredBy: userId })])
    return {
      answers: Object.fromEntries(mine.map((answer) => [answer.id, answer.latest])),
      results: Object.fromEntries([...results].map(([id, { counts, total }]) => [id, { counts, total }])),
    }
  } catch (error) {
    logError(event, error, { action: "drop-answers" })
    return { answers: {}, results: {} }
  }
}

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
