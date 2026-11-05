import type { DBTransactionAdapter } from "better-auth/adapters"
import type { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError } from "better-auth/api"
import { organization } from "better-auth/plugins"

const errors = organization().$ERROR_CODES

/** Give trigger refusals the same response as Better Auth's limit checks, before its error handler runs. */
export function teamLimitAdapter(database: ReturnType<typeof drizzleAdapter>): ReturnType<typeof drizzleAdapter> {
  return (options) => {
    const adapter = database(options)
    return {
      ...withLimitErrors(adapter),
      transaction: (callback) => adapter.transaction((transaction) => callback(withLimitErrors(transaction))),
    }
  }
}

function withLimitErrors(adapter: DBTransactionAdapter): DBTransactionAdapter {
  return {
    ...adapter,
    async create(input) {
      try {
        return await adapter.create(input)
      } catch (error) {
        if (input.model === "invitation" || input.model === "member") {
          let cause: unknown = error
          while (cause instanceof Error) {
            if (/^(?:D1_ERROR: )?DROP_TEAM_FULL(?:: SQLITE_CONSTRAINT(?:_TRIGGER)?)?$/.test(cause.message))
              throw APIError.from(
                "FORBIDDEN",
                input.model === "invitation"
                  ? errors.INVITATION_LIMIT_REACHED
                  : errors.ORGANIZATION_MEMBERSHIP_LIMIT_REACHED,
              )
            cause = cause.cause
          }
        }
        throw error
      }
    },
  }
}
