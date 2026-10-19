// Workers-only module imported by ViteHub's generated Cloudflare middleware, which every tsconfig reaches.
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>
}

import type { Identity } from "../server/utils/identity"

declare module "h3" {
  interface H3EventContext {
    dropIdentity?: Promise<Identity | null>
    dropAccessChecked?: boolean
  }
}
