// Workers-only module imported by ViteHub's generated Cloudflare middleware, which every tsconfig reaches.
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>
}

declare module "h3" {
  interface H3EventContext {
    dropIdentity?: Promise<import("../server/utils/identity").Identity | null>
    dropAccessChecked?: boolean
  }
}
