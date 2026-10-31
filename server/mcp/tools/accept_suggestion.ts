import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { HTTPError } from "h3"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { findCommentByNumber } from "../../utils/comments"
import { findDropByRef, toSummary } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"
import { acceptSuggestion } from "../../utils/suggestions"
import { dropLine, mcpDrop } from "../format"

export default defineMcpTool({
  name: "accept_suggestion",
  title: "Accept a suggestion",
  description:
    'Accept a suggested edit on a Markdown doc, by its comment number from read_drop (the ones that say "Suggests replacing it with" or "Suggests deleting it"): its words replace the selected text in the latest version, which is published as the next version, and the comment is resolved. Use it when the suggestion is right as written; when it needs changing, edit the doc and publish instead. Fails without changing anything when the selected words aren\'t in the Markdown exactly once.',
  inputSchema: toStandardJsonSchema(
    v.object({
      id: v.pipe(v.string(), v.description("Drop id, or its link.")),
      comment: v.pipe(
        v.number(),
        v.integer(),
        v.minValue(1),
        v.description("The suggestion's comment number, from read_drop."),
      ),
    }),
  ),
  handler: async ({ id, comment: n }, event) => {
    const who = await requireIdentity(event)
    const drop = await findDropByRef(id, event)
    if (!drop) throw new HTTPError({ status: 404, message: `No drop with id ${id} you can edit.` })
    const comment = await findCommentByNumber(drop, n)
    if (!comment) throw new HTTPError({ status: 404, message: `No comment #${n} on this drop.` })
    const next = mcpDrop(toSummary(await acceptSuggestion(drop, comment, who, event)), event.url.origin)
    return {
      content: [{ type: "text" as const, text: `Accepted suggestion #${n} as v${next.version}:\n${dropLine(next)}` }],
      structuredContent: next,
    }
  },
})
