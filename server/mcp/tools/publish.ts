import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { and, eq, inArray } from "drizzle-orm"
import { HTTPError } from "h3"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { db } from "vite-hub/database/drizzle"
import { LIFETIMES, MAX_KEEP_REASON } from "#shared/expiry"
import { comments } from "../../databases/config"
import { createDocDrop, findDrop, MAX_FILE_BYTES, permissions, publishApp, toSummary, versionChain } from "../../utils/drops"
import { shareChange, updateDrop } from "../../utils/drop-update"
import { requireIdentity } from "../../utils/identity"
import { annotationIssues } from "../../utils/markdown-document"
import { quotaToolResult } from "../../utils/quotas"
import { dropLine, mcpDrop } from "../format"

// No v.trim() or other transformations: they can't become JSON Schema, and tools/list publishes every input schema.
const Input = v.object({
  markdown: v.optional(v.pipe(v.string(), v.maxLength(MAX_FILE_BYTES), v.description("A doc in Markdown."))),
  html: v.optional(v.pipe(v.string(), v.maxLength(MAX_FILE_BYTES), v.description("A self-contained HTML page."))),
  files: v.optional(v.pipe(v.record(v.string(), v.string()), v.description(`A static app: path to UTF-8 contents, index.html required, at most ${MAX_FILE_BYTES} bytes in all. Each publish replaces every file.`))),
  file: v.optional(v.pipe(v.object({
    name: v.pipe(v.string(), v.description("File name with its extension, e.g. before.png.")),
    base64: v.pipe(v.string(), v.maxLength(Math.ceil(MAX_FILE_BYTES / 3) * 4 + 1024), v.description("The file's bytes, base64-encoded.")),
  }), v.description("Any other file up to 4 MiB: a screenshot, a PDF. Images get pin and area comments. Embed its fileUrl in a doc to make it part of that doc."))),
  title: v.optional(v.string()),
  previous: v.optional(v.pipe(v.string(), v.description("Id of the drop this publishes the next version of. It keeps that drop's sharing and lifetime unless you pass them."))),
  note: v.pipe(v.string(), v.minLength(1), v.maxLength(500), v.description("What this version is or what changed, like a commit message. People see it in the version history.")),
  lifetime: v.optional(v.pipe(v.picklist(LIFETIMES), v.description("Required for a new drop. temporary: prototypes and one-off answers, gone 14 days after the last visit. review: docs going through feedback, 30 days. keep: never expires, for pull request assets and anything linked from somewhere lasting; needs keepReason."))),
  keepReason: v.optional(v.pipe(v.string(), v.maxLength(MAX_KEEP_REASON), v.description("Why it should be kept, in a sentence or two (e.g. the pull request it belongs to). The owner sees it."))),
  share: v.optional(v.pipe(v.picklist(["private", "view", "comment", "edit"]), v.description("Who can open the link: private (default for new drops), or anyone with it who can view, comment, or edit (signed-in people only). Share when the user asked to, or when the drop is clearly meant for others, such as a PR asset."))),
  resolves: v.optional(v.pipe(v.array(v.pipe(v.number(), v.integer())), v.maxLength(90), v.description("Numbers of the previous version's open comments this version addresses. They're marked resolved."))),
})

export default defineMcpTool({
  name: "publish",
  title: "Publish a drop",
  description: "Publish one thing for review: a doc (markdown or html), a static app (files), or a file such as a screenshot (file). Pass previous to publish its next version. Every call creates a drop or a version, so don't repeat a call that succeeded.",
  inputSchema: toStandardJsonSchema(Input),
  handler: async (input, event) => quotaToolResult(async () => {
    const who = await requireIdentity(event)
    const given = (["markdown", "html", "files", "file"] as const).filter(key => input[key] !== undefined)
    if (given.length !== 1) throw new HTTPError({ status: 400, message: "Pass exactly one of markdown, html, files, or file." })
    if (!input.previous && !input.lifetime) throw new HTTPError({ status: 400, message: "Say how long this drop should live: lifetime temporary, review, or keep." })
    let previous = input.previous ? await findDrop(input.previous, event) : null
    if (previous?.expired && permissions(previous, who).manage) throw new HTTPError({ status: 409, message: `${input.previous} is in the Trash. Restore it with update_drop first, or publish a new drop.` })
    if (input.previous && (!previous || !permissions(previous, who).edit)) throw new HTTPError({ status: 404, message: `No drop you can publish to with id ${input.previous}.` })
    if (previous) previous = (await versionChain(previous))[0] ?? previous
    const share = input.share ? shareChange(input.share) : {}
    const life = { lifetime: input.lifetime, keepReason: input.keepReason, note: input.note }

    let row
    if (input.files) {
      if (previous && previous.kind !== "app") throw new HTTPError({ status: 400, message: "previous is a doc; publish files only to an app." })
      row = await publishApp(who, { id: previous?.id, name: input.title, files: input.files, ...share, ...life }, event)
    }
    else {
      if (previous?.kind === "app") throw new HTTPError({ status: 400, message: "previous is an app; publish its next version with files." })
      let filename: string, bytes: Uint8Array
      if (input.file) {
        filename = input.file.name
        try { bytes = Uint8Array.from(atob(input.file.base64.replace(/\s+/g, "")), char => char.charCodeAt(0)) }
        catch { throw new HTTPError({ status: 400, message: "file.base64 isn't valid base64." }) }
      }
      else {
        const source = (input.markdown ?? input.html)!
        if (!source.trim()) throw new HTTPError({ status: 400, message: "The doc is empty." })
        // A broken annotated screenshot would render with marks in the wrong place; send the agent back to fix it.
        const issues = input.markdown ? await annotationIssues(source) : []
        if (issues.length) throw new HTTPError({ status: 400, message: `Fix the annotated screenshots and publish again:\n${issues.map(issue => `- ${issue}`).join("\n")}` })
        filename = input.html ? "doc.html" : "doc.md"
        bytes = new TextEncoder().encode(source)
      }
      row = await createDocDrop(who, { filename, bytes, title: input.title, supersedes: previous?.id, ...share, ...life }, event)
      // The share applies to every version, like a change on the drop's page.
      if (previous && input.share) await updateDrop({ ...row, expired: false }, who, share, event)
    }

    let resolved: number[] = []
    if (previous && input.resolves?.length) {
      const open = await db.select({ n: comments.n }).from(comments).where(and(eq(comments.dropId, previous.id), inArray(comments.n, input.resolves), eq(comments.resolved, false)))
      resolved = open.map(comment => comment.n)
      if (resolved.length) await db.update(comments).set({ resolved: true }).where(and(eq(comments.dropId, previous.id), inArray(comments.n, resolved)))
    }

    const fresh = await findDrop(row.id, event) ?? row
    const drop = mcpDrop(toSummary(fresh), event.url.origin, fresh)
    const result = { ...drop, ...(resolved.length ? { resolved } : {}) }
    return { content: [{ type: "text" as const, text: `Published${drop.version > 1 ? ` v${drop.version}` : ""}${resolved.length ? `, resolved ${resolved.map(n => `#${n}`).join(", ")}` : ""}:\n${dropLine(drop)}` }], structuredContent: result }
  }),
})
