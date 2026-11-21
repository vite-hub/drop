import { defineValidatedHandler, getValidatedRouterParams, HTTPError } from "h3"
import { useLogger } from "evlog/nitro/v3"
import * as v from "valibot"
import { SkillPatchSchema } from "#shared/schemas"
import { requireAdmin } from "../../utils/identity"
import { logAudit } from "../../utils/logs"
import settings from "../../skills"

const Params = v.object({ name: v.pipe(v.string(), v.regex(/^[a-z0-9-]{1,64}$/)) })

export default defineValidatedHandler({
  validate: { body: SkillPatchSchema },
  async handler(event) {
    const who = await requireAdmin(event)
    const { name } = await getValidatedRouterParams(event, Params)
    const { enabled } = await event.req.json()
    const [error] = await settings.set(name, enabled)
    if (error?.code === "SKILL_NOT_FOUND") throw new HTTPError({ status: 404, statusText: "No skill with that name." })
    if (error) throw error
    useLogger(event).set({ skill: { name, enabled } })
    logAudit(event, who, enabled ? "skill.enable" : "skill.disable", { type: "skill", id: name })
    return { ok: true }
  },
})
