import type { drops } from "../../databases/config"
import type { Lifetime } from "#shared/expiry"
import type { Grant } from "../nodes"

export type DropRow = typeof drops.$inferSelect & {
  /** An earlier version (`?v=`): the drop as it is now. The row's own fields are that version's, sharing and life aside. */
  head?: typeof drops.$inferSelect
  ownerBanned?: boolean
  expired?: boolean
  raw?: typeof drops.$inferSelect
  ancestors?: (typeof drops.$inferSelect)[]
  grants?: Grant[]
  sharedFrom?: { id: string; title: string }
}

export interface LifetimeInput {
  lifetime?: Lifetime
  keepReason?: string
  note?: string
}
