import { defineHandler } from "h3"
import { useServerEnv } from "vite-hub/env"

declare module "h3" {
  interface H3EventContext {
    dropUsageCounts?: boolean
  }
}

export default defineHandler((event) => {
  event.context.dropUsageCounts = useServerEnv(event).drop.usageCounts
})
