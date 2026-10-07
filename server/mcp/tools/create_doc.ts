import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { HTTPError } from "h3"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { createDocDrop, dropPageUrl, MAX_FILE_BYTES } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"

export default defineMcpTool({
  name: "create_doc",
  title: "Drop a doc",
  description: "Drop a doc: Markdown (default) or a self-contained HTML page. Private unless shared is true. Pass supersedes to publish it as the next version of an existing doc.",
  inputSchema: toStandardJsonSchema(v.object({
    // No v.trim(): transformations can't become JSON Schema, and tools/list publishes every input schema.
    markdown: v.pipe(v.string(), v.nonEmpty("markdown is required."), v.maxLength(MAX_FILE_BYTES, "Docs are limited to 4 MiB when UTF-8 encoded."), v.description("The doc's source: Markdown, or HTML when format is html.")),
    format: v.optional(v.picklist(["markdown", "html"]), "markdown"),
    title: v.optional(v.string()),
    shared: v.optional(v.boolean(), false),
    supersedes: v.optional(v.pipe(v.string(), v.description("Id of the doc this replaces."))),
  })),
  handler: async ({ markdown, format, title, shared, supersedes }, event) => {
    if (!markdown.trim()) throw new HTTPError({ status: 400, message: "markdown is required." })
    const drop = await createDocDrop(await requireIdentity(event), {
      filename: format === "html" ? "doc.html" : "doc.md",
      bytes: new TextEncoder().encode(markdown),
      title,
      supersedes,
      visibility: shared ? "shared" : undefined,
    })
    return `Dropped${drop.version > 1 ? ` v${drop.version}` : ""} ${drop.visibility === "shared" ? "and shared" : "privately"}: ${dropPageUrl(event.url.origin, drop.id)} (id=${drop.id})`
  },
})
