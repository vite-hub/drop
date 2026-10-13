import { defineValidatedHandler, getValidatedRouterParams, HTTPError } from "h3"
import { useLogger } from "evlog/nitro/v3"
import * as v from "valibot"
import { SkillPatchSchema } from "#shared/schemas"
import { requireAdmin } from "../../utils/identity"
import { findSkill, setSkillEnabled } from "../../utils/skills"

const Params = v.object({ name: v.pipe(v.string(), v.regex(/^[a-z0-9-]{1,64}$/)) })

/** Admins switch a built-in skill on or off for the whole deployment: the catalog, MCP, and discovery. */
export default defineValidatedHandler({
  validate: { body: SkillPatchSchema },
  async handler(event) {
    const who = await requireAdmin(event)
    const { name } = await getValidatedRouterParams(event, Params)
    if (!findSkill(name)) throw new HTTPError({ status: 404, statusText: "No skill with that name." })
    const { enabled } = await event.req.json()
    await setSkillEnabled(name, enabled, who.userId)
    useLogger(event).set({ skill: { name, enabled } })
    return { ok: true }
  },
})
