import { readFileSync } from "node:fs"

const directory = new URL("../server/databases/default/migrations/", import.meta.url)

/** The second a folder name starts with, such as 20261027095547, in milliseconds. */
function secondOf(tag) {
  const [, year, month, day, hour, minute, second] = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)_/.exec(tag)
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
}

/**
 * Drop's migrations in the order D1 applied them, by their Wrangler file name. Each is a Drizzle Kit 1.0 folder
 * (`tag`), the Wrangler `name` that D1's `d1_migrations` records, from d1-migrations.json, `when`, the folder's second
 * in milliseconds as Drizzle's ledger records it, and its `sql`.
 */
export function migrations() {
  const names = JSON.parse(readFileSync(new URL("d1-migrations.json", directory), "utf8"))
  return Object.entries(names)
    .map(([tag, name]) => ({
      tag,
      name,
      when: secondOf(tag),
      sql: readFileSync(new URL(`${tag}/migration.sql`, directory), "utf8"),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
