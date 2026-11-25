import { assertBodySize, getValidatedRouterParams, type H3Event } from "h3"
import * as v from "valibot"

const Id = v.pipe(v.string(), v.minLength(1), v.maxLength(64))
const IdParams = v.object({ id: Id })
const MessageParams = v.object({ id: Id, messageId: Id })

export const routeId = async (event: H3Event) => (await getValidatedRouterParams(event, IdParams)).id

export const routeMessage = (event: H3Event) => getValidatedRouterParams(event, MessageParams)

export function readFormWithin(event: H3Event, limit: number): Promise<FormData> {
  assertBodySize(event, limit)
  const type = event.req.headers.get("content-type") ?? ""
  return new Response(event.req.body, { headers: { "content-type": type } }).formData()
}
