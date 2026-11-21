import { assertBodySize, getValidatedRouterParams, type H3Event } from "h3"
import * as v from "valibot"

const IdParams = v.object({ id: v.pipe(v.string(), v.minLength(1), v.maxLength(64)) })

export const routeId = async (event: H3Event) => (await getValidatedRouterParams(event, IdParams)).id

export function readFormWithin(event: H3Event, limit: number): Promise<FormData> {
  assertBodySize(event, limit)
  const type = event.req.headers.get("content-type") ?? ""
  return new Response(event.req.body, { headers: { "content-type": type } }).formData()
}
