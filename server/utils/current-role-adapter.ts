import type { DBTransactionAdapter } from "better-auth/adapters"
import type { drizzleAdapter } from "better-auth/adapters/drizzle"

type Person = { email: string; emailVerified?: boolean | null }

/** Auth's membership policy runs before application hooks. Give it Drop's current role on every user read. */
export function currentRoleAdapter(
  database: ReturnType<typeof drizzleAdapter>,
  role: (person: Person) => string,
): ReturnType<typeof drizzleAdapter> {
  function wrap(adapter: DBTransactionAdapter): DBTransactionAdapter {
    return {
      ...adapter,
      async findOne(input) {
        const row = await adapter.findOne(input)
        if (input.model !== "user" || !row) return row
        // Policy reads request the whole user; leave projections without an email alone.
        if ("email" in row && typeof row.email === "string") {
          const emailVerified = "emailVerified" in row && row.emailVerified === true
          return { ...row, role: role({ email: row.email, emailVerified }) }
        }
        return row
      },
    }
  }
  return (options) => {
    const adapter = database(options)
    return {
      ...wrap(adapter),
      transaction: (callback) => adapter.transaction((transaction) => callback(wrap(transaction))),
    }
  }
}
