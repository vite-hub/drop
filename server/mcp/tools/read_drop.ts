import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { HTTPError } from "h3"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { listComments, toComment } from "../../utils/comments"
import { dropDetail, findDrop, permissions } from "../../utils/drops"
import { recordVisit } from "../../utils/expiry"
import { requireIdentity } from "../../utils/identity"
import { commentLine, commentTarget, mcpDrop } from "../format"

export default defineMcpTool({
  name: "read_drop",
  title: "Read a drop",
  description: "Read a drop: a doc's source or every file of an app, its open review comments, its versions with their notes, and the files a doc embeds. Address the open comments in the next version (publish with previous and resolves).",
  annotations: { readOnlyHint: true },
  inputSchema: toStandardJsonSchema(v.object({
    id: v.pipe(v.string(), v.description("Drop id.")),
    resolved: v.optional(v.pipe(v.boolean(), v.description("Include resolved comments too.")), false),
  })),
  handler: async ({ id, resolved }, event) => {
    const who = await requireIdentity(event)
    const drop = await findDrop(id, event)
    if (!drop || !permissions(drop, who).view) throw new HTTPError({ status: 404, message: `No drop with id ${id}.` })
    await recordVisit(event, drop, who, "beacon")
    const detail = await dropDetail(drop, who, event.url.origin, event)
    const comments = (await listComments(drop.id)).map(row => toComment(row, who)).filter(comment => resolved || !comment.resolved)
    const versions = detail.versions.map(({ id, version, note, actorName, createdAt }) => ({ id, version, note, by: actorName, at: new Date(createdAt).toISOString() }))
    const meta = mcpDrop(detail, event.url.origin, drop)

    const sections = [
      `${meta.title} (${meta.kind} v${meta.version}, ${meta.share}, ${meta.lifetime}, ${meta.status.toLowerCase()}) ${meta.url}`,
      `## Versions\n${versions.map(item => `v${item.version} ${item.id}${item.note ? `: ${item.note}` : ""} (${item.by})`).join("\n")}`,
      `## ${resolved ? "Comments" : "Open comments"}\n${comments.map(comment => `${commentLine(comment)}${comment.resolved ? " [resolved]" : ""}`).join("\n") || "None."}`,
      ...(detail.attachments?.length ? [`## Embedded files\n${detail.attachments.map(file => `- ${file.filename} (${file.kind}) ${file.url}`).join("\n")}`] : []),
      detail.files
        ? `## Files\n${Object.entries(detail.files).map(([path, content]) => `--- ${path}\n${content}`).join("\n\n")}`
        : `## Content\n${detail.content ?? `Binary file: ${detail.url}`}`,
    ]
    return {
      content: [{ type: "text" as const, text: sections.join("\n\n") }],
      structuredContent: {
        ...meta, versions,
        comments: comments.map(comment => ({ n: comment.n, kind: comment.kind, target: commentTarget(comment), body: comment.body, author: comment.authorName, page: comment.page, resolved: comment.resolved })),
        attachments: detail.attachments ?? [],
        ...(detail.files ? { files: detail.files } : { content: detail.content ?? null, fileUrl: detail.url ?? null }),
      },
    }
  },
})
