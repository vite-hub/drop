import { readFileSync } from "node:fs"

const directory = new URL("../server/databases/default/migrations/", import.meta.url)

function secondOf(tag) {
  const [, year, month, day, hour, minute, second] = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)_/.exec(tag)
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
}

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
