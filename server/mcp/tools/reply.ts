import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { HTTPError } from "h3"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { addReply, findCommentByNumber } from "../../utils/comments"
import { findDropByRef, permissions } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"

export default defineMcpTool({
  name: "reply",
  title: "Reply to a comment",
  description:
    "Reply in a comment's thread, by its number from read_drop: answer a question, say what you changed, or ask what they meant. Fix what a comment asks for in the next version; reply when words are the answer.",
  inputSchema: toStandardJsonSchema(
    v.object({
      id: v.pipe(v.string(), v.description("Drop id, or its link.")),
      comment: v.pipe(v.number(), v.integer(), v.minValue(1), v.description("The comment's number, from read_drop.")),
      // No v.trim(): it can't become JSON Schema, and one schema that fails breaks tools/list for every tool. Trimmed below.
      body: v.pipe(v.string(), v.minLength(1), v.maxLength(4000), v.description("The reply, in plain words.")),
    }),
  ),
  handler: async ({ id, comment: n, body }, event) => {
    const who = await requireIdentity(event)
    const text = body.trim()
    if (!text) throw new HTTPError({ status: 400, message: "Write the reply." })
    const drop = await findDropByRef(id, event)
    if (!drop || !permissions(drop, who).comment)
      throw new HTTPError({ status: 404, message: `No drop with id ${id} you can comment on.` })
    const thread = await findCommentByNumber(drop, n)
    if (!thread) throw new HTTPError({ status: 404, message: `No comment #${n} on this drop.` })
    const reply = await addReply(thread, who, text)
    return { content: [{ type: "text" as const, text: `Replied to #${n}.` }], structuredContent: { comment: n, reply } }
  },
})
