import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { HTTPError } from "h3"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { listComments } from "../../utils/comments"
import { findDrop, permissions } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"

export default defineMcpTool({
  name: "list_comments",
  title: "List open comments",
  description: "Open review comments on a drop: the quoted text, the comment, and who wrote it. Address them in the next version.",
  annotations: { readOnlyHint: true },
  inputSchema: toStandardJsonSchema(v.object({ id: v.pipe(v.string(), v.description("Drop id from list_drops.")) })),
  handler: async ({ id }, event) => {
    const who = await requireIdentity(event)
    const drop = await findDrop(id, event)
    if (!drop || !permissions(drop, who).view) throw new HTTPError({ status: 404, message: `No drop with id ${id}.` })
    const open = (await listComments(drop.id)).filter(comment => !comment.resolved)
    return open.map(comment => `${comment.n}. ${comment.quote ? `> ${comment.quote}\n   ` : ""}${comment.body} (${comment.authorName}${comment.page ? `, ${comment.page}` : ""})`).join("\n") || "No open comments."
  },
})
