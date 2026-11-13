import { readFileSync } from "node:fs"

const directory = new URL("../server/databases/default/migrations/", import.meta.url)

/** The SQL of every migration, in the order Wrangler applies them to D1 (by the names in d1-migrations.json). */
export function migrationSql() {
  const names = JSON.parse(readFileSync(new URL("d1-migrations.json", directory), "utf8"))
  return Object.entries(names)
    .sort(([, a], [, b]) => (a < b ? -1 : 1))
    .map(([folder]) => readFileSync(new URL(`${folder}/migration.sql`, directory), "utf8"))
}
