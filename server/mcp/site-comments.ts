import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { HTTPError, type H3Event } from "h3"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { commentsMcpTools } from "vite-hub/comments/runtime"
import { comments } from "../comments"
import { requireIdentity } from "../utils/identity"

/** The ViteHub Comments tools, by name: the same ones ViteHub MCP serves at /_vitehub/mcp. */
const tools = new Map(commentsMcpTools(comments).map((tool) => [tool.name, tool]))

/**
 * Runs a ViteHub Comments tool for a Drop admin. Comments on Drop's own pages are the team's notes about Drop, so
 * only admins, the people the Console lets use them, read or change them here.
 */
async function run(name: string, input: Record<string, unknown>, event: H3Event) {
  const who = await requireIdentity(event)
  if (who.role !== "admin")
    throw new HTTPError({ status: 403, message: "Only Drop admins read the comments on Drop's pages." })
  const tool = tools.get(name)!
  const result = await tool.call(input, {
    user: { id: who.userId, name: who.name, email: who.email, image: who.image },
    event,
  })
  return {
    content: [{ type: "text" as const, text: result.text }],
    ...(result.structured ? { structuredContent: result.structured } : {}),
    isError: result.isError === true,
  }
}

const thread = v.pipe(v.string(), v.minLength(1), v.description("The thread id, from comments_list_threads."))

/**
 * Comments that admins left on Drop's own pages with the Comments toolbar: the agent reads where each one is (page,
 * element, Vue components and their files), fixes the code, then replies and resolves.
 */
export const siteCommentTools = [
  defineMcpTool({
    name: "comments_list_threads",
    title: tools.get("comments_list_threads")!.title,
    description: tools.get("comments_list_threads")!.description,
    annotations: { readOnlyHint: true },
    inputSchema: toStandardJsonSchema(
      v.object({
        page: v.optional(v.pipe(v.string(), v.description("Only threads of this pathname, such as /pricing."))),
        status: v.optional(v.pipe(v.picklist(["open", "resolved"]), v.description("Default: open."))),
        search: v.optional(v.pipe(v.string(), v.description("Only threads whose comments contain this text."))),
        limit: v.optional(
          v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100), v.description("Default 25.")),
        ),
      }),
    ),
    handler: (input, event) => run("comments_list_threads", input, event),
  }),
  defineMcpTool({
    name: "comments_get_thread",
    title: tools.get("comments_get_thread")!.title,
    description: tools.get("comments_get_thread")!.description,
    annotations: { readOnlyHint: true },
    inputSchema: toStandardJsonSchema(v.object({ id: thread })),
    handler: (input, event) => run("comments_get_thread", input, event),
  }),
  defineMcpTool({
    name: "comments_reply",
    title: tools.get("comments_reply")!.title,
    description: tools.get("comments_reply")!.description,
    inputSchema: toStandardJsonSchema(
      v.object({
        id: thread,
        // No v.trim(): it can't become JSON Schema, and one schema that fails breaks tools/list for every tool.
        body: v.pipe(v.string(), v.minLength(1), v.maxLength(4000), v.description("The reply, in plain words.")),
      }),
    ),
    handler: (input, event) => run("comments_reply", input, event),
  }),
  defineMcpTool({
    name: "comments_resolve_thread",
    title: tools.get("comments_resolve_thread")!.title,
    description: tools.get("comments_resolve_thread")!.description,
    annotations: { idempotentHint: true },
    inputSchema: toStandardJsonSchema(
      v.object({
        id: thread,
        resolved: v.optional(v.pipe(v.boolean(), v.description("Default true. False reopens the thread."))),
      }),
    ),
    handler: (input, event) => run("comments_resolve_thread", input, event),
  }),
]
