// What Drop's middleware leaves on the event for later handlers. A module file, so this augments h3 instead of
// replacing it.
import type { Identity } from "../server/utils/identity"

declare module "h3" {
  interface H3EventContext {
    /** The access gate's identity lookup, shared so error pages don't look the caller up again. */
    dropIdentity?: Promise<Identity | null>
    dropAccessChecked?: boolean
  }
}
