import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { HTTPError } from "h3"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { addReply, findCommentByNumber, setResolved, wroteThread } from "../../utils/comments"
import { permissions } from "../../utils/drops"
import { findDropOrSite, mayResolveSite } from "../../utils/review"
import { requireIdentity } from "../../utils/identity"

export default defineMcpTool({
  name: "reply",
  title: "Reply to a comment",
  description:
    "Reply in a comment's thread, by its number from read_drop: answer a question, say what you changed, or ask what they meant. Fix what a comment asks for in the next version; reply when words are the answer. On a site review, once your fix is on the site, reply with what you changed and resolve: true, so the reviewer reads what changed and the comment's pin leaves the page.",
  inputSchema: toStandardJsonSchema(
    v.object({
      id: v.pipe(
        v.string(),
        v.description(
          "Drop id, its link, or the address of a page under site review, such as a pull request's preview: that finds the site drop covering it.",
        ),
      ),
      comment: v.pipe(v.number(), v.integer(), v.minValue(1), v.description("The comment's number, from read_drop.")),
      // No v.trim(): it can't become JSON Schema, and one schema that fails breaks tools/list for every tool. Trimmed below.
      body: v.pipe(v.string(), v.minLength(1), v.maxLength(4000), v.description("The reply, in plain words.")),
      resolve: v.optional(
        v.pipe(v.boolean(), v.description("Resolve the comment after replying: you fixed what it asks for.")),
      ),
    }),
  ),
  handler: async ({ id, comment: n, body, resolve }, event) => {
    const who = await requireIdentity(event)
    const text = body.trim()
    if (!text) throw new HTTPError({ status: 400, message: "Write the reply." })
    const { drop } = await findDropOrSite(id, who, event)
    if (!drop || !permissions(drop, who).comment)
      throw new HTTPError({ status: 404, message: `No drop with id ${id} you can comment on.` })
    const thread = await findCommentByNumber(drop, n)
    if (!thread) throw new HTTPError({ status: 404, message: `No comment #${n} on this drop.` })
    const mayResolve =
      drop.kind === "site" ? mayResolveSite(drop, who, wroteThread(thread, who)) : permissions(drop, who).manage
    if (resolve && !mayResolve)
      throw new HTTPError({ status: 403, message: `Only the drop's owner resolves #${n}. Nothing was sent.` })
    const reply = await addReply(thread, who, text)
    const resolved = Boolean(resolve) && thread.status === "open"
    if (resolved) await setResolved(thread, true, who)
    return {
      content: [{ type: "text" as const, text: `Replied to #${n}${resolved ? " and resolved it" : ""}.` }],
      structuredContent: { comment: n, reply, ...(resolve ? { resolved } : {}) },
    }
  },
})
