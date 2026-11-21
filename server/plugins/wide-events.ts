import { definePlugin } from "nitro"
import { useRuntimeConfig } from "nitro/runtime-config"
import { setDeploymentHost } from "../utils/logs"

export default definePlugin((app) => {
  const { host } = useRuntimeConfig().deployment
  setDeploymentHost(host)
  app.hooks!.hook("evlog:enrich", ({ event }) => {
    event.deployment = { host }
  })
})
