import { eq } from "drizzle-orm"
import { defineHandler, getRouterParam, HTTPError, readValidatedBody } from "h3"
import * as v from "valibot"
import { db } from "vite-hub/database/drizzle"
import { drops } from "../../databases/config"
import { findDrop, permissions, toSummary } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"

const Body = v.object({
  visibility: v.optional(v.picklist(["private", "shared"])),
  access: v.optional(v.picklist(["view", "comment", "edit"])),
  title: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(160))),
})

/** Share, unshare, change the link's access level, or rename. */
export default defineHandler(async (event) => {
  const who = await requireIdentity(event)
  const drop = await findDrop(getRouterParam(event, "id") ?? "")
  if (!drop || !permissions(drop, who).manage) throw new HTTPError({ status: 404, statusText: "No drop with that id." })
  const body = await readValidatedBody(event, Body)
  await db.update(drops).set({ ...body }).where(eq(drops.id, drop.id))
  return toSummary({ ...drop, ...body })
})
