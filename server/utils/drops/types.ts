import type { drops } from "../../databases/default/index"
import type { Lifetime } from "#shared/expiry"
import type { Grant } from "../nodes"

export type DropRow = typeof drops.$inferSelect & {
  head?: typeof drops.$inferSelect
  ownerBanned?: boolean
  ownerProfile?: { name: string; image: string | null }
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
