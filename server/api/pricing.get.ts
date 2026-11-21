// doctor-disable nuxt/middleware/no-route-middleware-api-security -- public on purpose: the pricing page reads it signed out.
import { defineHandler, HTTPError } from "h3"
import { quotaConfig } from "../utils/quotas"
import { billingConfig } from "../utils/teams"

export default defineHandler((event) => {
  const billing = billingConfig(event)
  if (!billing.enabled) throw new HTTPError({ status: 404, statusText: "This Drop has no paid plans." })
  return { freeMembers: billing.freeMembers, freeKept: quotaConfig().freeKept, annual: Boolean(billing.annualPriceId) }
})
