import { definePlugin } from "nitro"
import { useRuntimeConfig } from "nitro/runtime-config"
import { setDeploymentHost } from "../utils/logs"

/**
 * Every wide event names the host it ran on: request events here, before they're printed or drained, and the events
 * Drop emits outside a request through server/utils/logs.ts.
 */
export default definePlugin((app) => {
  const { host } = useRuntimeConfig().deployment
  setDeploymentHost(host)
  app.hooks!.hook("evlog:enrich", ({ event }) => {
    event.deployment = { host }
  })
})
