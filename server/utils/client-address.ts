import { getRequestIP, type H3Event } from "h3"
import { useRuntimeConfig } from "nitro/runtime-config"
import { forwardedAddress } from "#shared/client-ip"

export function clientAddress(event: H3Event): string | undefined {
  return forwardedAddress(event.req.headers, useRuntimeConfig().clientIpHeader) || getRequestIP(event)
}
