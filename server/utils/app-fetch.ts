import type { H3Event } from "h3"

export const appFetch = (event: H3Event, path: string, headers: HeadersInit) =>
  event.app!.fetch(Object.assign(new Request(new URL(path, event.url), { headers }), { runtime: event.req.runtime }))
