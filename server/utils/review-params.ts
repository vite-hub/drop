import { getValidatedRouterParams, type H3Event } from "h3"
import * as v from "valibot"

const NumberParams = v.object({
  n: v.pipe(v.string(), v.regex(/^\d{1,9}$/, "Give the comment's number."), v.transform(Number)),
})

/** The `[n]` route param: a comment's number on the site, as the page shows it. */
export const routeNumber = async (event: H3Event) => (await getValidatedRouterParams(event, NumberParams)).n
