import type { DBTransactionAdapter } from "better-auth/adapters"
import type { drizzleAdapter } from "better-auth/adapters/drizzle"
import * as v from "valibot"

type Person = { email: string; emailVerified?: boolean | null }

// Policy reads request the whole user; projections without an email stay as they are.
const RoleSubject = v.object({ email: v.string(), emailVerified: v.nullish(v.boolean()) })

/** Auth's membership policy runs before application hooks. Give it Drop's current role on every user read. */
export function currentRoleAdapter(
  database: ReturnType<typeof drizzleAdapter>,
  role: (person: Person) => string,
): ReturnType<typeof drizzleAdapter> {
  function wrap(adapter: DBTransactionAdapter): DBTransactionAdapter {
    return {
      ...adapter,
      // The inner read gives the row's type, so the wrapper keeps the type Better Auth asked for.
      findOne: (input) => (input.model === "user" ? withRole(adapter.findOne(input), role) : adapter.findOne(input)),
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

async function withRole<Row>(read: Promise<Row>, role: (person: Person) => string): Promise<Row> {
  const row = await read
  const person = v.safeParse(RoleSubject, row)
  if (!person.success) return row
  return { ...row, role: role({ email: person.output.email, emailVerified: person.output.emailVerified === true }) }
}
