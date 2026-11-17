import { definePlugin } from "nitro"
import { useRuntimeConfig } from "nitro/runtime-config"

/**
 * Paths whose last part is a credential: an upload URL's sealed ticket (server/utils/uploads.ts) stands in for the
 * agent's sign-in, and a password reset link's token for the person's.
 */
const SECRET_PATHS = /(\/api\/uploads\/|\/api\/auth\/reset-password\/)[^/?#\s"]+/g

// evlog's own redaction masks IPv4 addresses but not IPv6 ones.
const IPV6 =
  /(?<![\w:.])(?:(?:[\da-f]{1,4}:){7}[\da-f]{1,4}|(?:[\da-f]{1,4}:){1,7}:|(?:[\da-f]{1,4}:){1,6}:[\da-f]{1,4}|(?:[\da-f]{1,4}:){1,5}(?::[\da-f]{1,4}){1,2}|(?:[\da-f]{1,4}:){1,4}(?::[\da-f]{1,4}){1,3}|(?:[\da-f]{1,4}:){1,3}(?::[\da-f]{1,4}){1,4}|(?:[\da-f]{1,4}:){1,2}(?::[\da-f]{1,4}){1,5}|[\da-f]{1,4}:(?::[\da-f]{1,4}){1,6}|:(?::[\da-f]{1,4}){1,7})(?![\w:])/gi

const scrub = (text: string) => text.replace(SECRET_PATHS, "$1[REDACTED]").replace(IPV6, "[REDACTED]")

/**
 * Every request's wide event names the host it ran on, and loses what evlog's JSON options can't redact: credentials
 * in paths and IPv6 addresses. `evlog:enrich` runs before the event is printed or drained.
 */
export default definePlugin((app) => {
  const { host } = useRuntimeConfig().deployment
  app.hooks!.hook("evlog:enrich", (context) => {
    // The event is JSON, as it's printed: scrubbing its text reaches every field, however deep.
    const json = scrub(JSON.stringify(context.event))
    Object.assign(context.event, JSON.parse(json), { deployment: { host } })
  })
})
