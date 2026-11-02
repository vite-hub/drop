import type { H3Event } from "h3"

/** A sub-request through this app, not the network: it keeps the platform runtime (bindings) of this request. */
export const appFetch = (event: H3Event, path: string, headers: HeadersInit) =>
  event.app!.fetch(Object.assign(new Request(new URL(path, event.url), { headers }), { runtime: event.req.runtime }))
