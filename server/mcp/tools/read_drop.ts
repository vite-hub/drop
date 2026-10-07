import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { HTTPError } from "h3"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { dropDetail, findDrop, permissions } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"

export default defineMcpTool({
  name: "read_drop",
  title: "Read a drop",
  description: "Read a doc's Markdown, or every file of an app.",
  annotations: { readOnlyHint: true },
  inputSchema: toStandardJsonSchema(v.object({ id: v.pipe(v.string(), v.description("Drop id from list_drops.")) })),
  handler: async ({ id }, event) => {
    const who = await requireIdentity(event)
    const drop = await findDrop(id)
    if (!drop || !permissions(drop, who).view) throw new HTTPError({ status: 404, message: `No drop with id ${id}.` })
    const detail = await dropDetail(drop, who, event.url.origin)
    if (detail.files) return Object.entries(detail.files).map(([path, content]) => `--- ${path}\n${content}`).join("\n\n")
    return detail.content ?? `Binary file: ${detail.url}`
  },
})
