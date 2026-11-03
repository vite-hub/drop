import { defineHandler, HTTPError } from "h3"
import { comments } from "../../../comments"
import { subjectFor } from "../../../utils/comments"
import { findDropAt, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"

/**
 * Whom "@" may name on this drop (`?q=` filters by name): ViteHub Comments' `people`, less anyone `canMention` turns
 * away, at most 20 (server/comments.ts). The comment boxes and the doc editor's "@" menu both ask here. Only signed-in
 * people may list them; administrative data belongs in the Console.
 */
export default defineHandler(async (event) => {
  const [drop, who] = await Promise.all([findDropAt(await routeId(event), undefined, event), identify(event)])
  if (!drop || !permissions(drop, who).view) throw new HTTPError({ status: 404, statusText: "No drop with that id." })
  if (!who) return []
  const query = (event.url.searchParams.get("q") ?? "").replace(/[%_]/g, "").slice(0, 40)
  const [error, people] = await comments.people({
    query,
    user: { id: who.userId, name: who.name, identity: who },
    subject: await subjectFor(drop),
  })
  if (error) throw new HTTPError({ status: 503, statusText: "Comments are temporarily unavailable.", cause: error })
  event.res.headers.set("Cache-Control", "private, no-store")
  return people
})
