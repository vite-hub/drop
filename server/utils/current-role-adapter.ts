import type { DBTransactionAdapter } from "better-auth/adapters"
import type { drizzleAdapter } from "better-auth/adapters/drizzle"
import * as v from "valibot"

type Person = { email: string; emailVerified?: boolean | null }

const RoleSubject = v.object({ email: v.string(), emailVerified: v.nullish(v.boolean()) })

export function currentRoleAdapter(
  database: ReturnType<typeof drizzleAdapter>,
  role: (person: Person) => string,
): ReturnType<typeof drizzleAdapter> {
  function wrap(adapter: DBTransactionAdapter): DBTransactionAdapter {
    return {
      ...adapter,
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
