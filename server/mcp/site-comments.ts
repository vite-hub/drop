import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { HTTPError, type H3Event } from "h3"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { commentsMcpTools } from "vite-hub/comments/runtime"
import comments from "../comments"
import { requireIdentity } from "../utils/identity"

const tools = new Map(commentsMcpTools(comments).map((tool) => [tool.name, tool]))

async function run(name: string, input: Record<string, unknown>, event: H3Event) {
  const who = await requireIdentity(event)
  if (who.role !== "admin")
    throw new HTTPError({
      status: 403,
      message: `Only Drop admins read the ViteHub toolbar comments on Drop's interface. ${SITE_REVIEWS}`,
    })
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

const SITE_REVIEWS =
  "For comments people left on a site under review, such as a pull request's preview, call read_drop with the page's address, then reply with resolve: true once you've fixed each one."

const describe = (name: string) =>
  `${
    name === "comments_list_threads"
      ? "ViteHub toolbar comments: threads left with the ViteHub Comments toolbar on Drop's own interface, on any Drop page including a drop's page (/d/<id>/<slug>), about Drop's UI, not a drop's content. For Drop admins. Pass a drop's link as page."
      : "ViteHub toolbar comments on Drop's interface, for Drop admins:"
  } ${tools.get(name)!.description} ${SITE_REVIEWS}`

const thread = v.pipe(v.string(), v.minLength(1), v.description("The thread id, from comments_list_threads."))

export const siteCommentTools = [
  defineMcpTool({
    name: "comments_list_threads",
    title: tools.get("comments_list_threads")!.title,
    description: describe("comments_list_threads"),
    annotations: { readOnlyHint: true },
    inputSchema: toStandardJsonSchema(
      v.object({
        page: v.optional(
          v.pipe(
            v.string(),
            v.description("Only threads on this Drop page: a drop's link, or its path such as /d/<id>/<slug>."),
          ),
        ),
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
    description: describe("comments_get_thread"),
    annotations: { readOnlyHint: true },
    inputSchema: toStandardJsonSchema(v.object({ id: thread })),
    handler: (input, event) => run("comments_get_thread", input, event),
  }),
  defineMcpTool({
    name: "comments_reply",
    title: tools.get("comments_reply")!.title,
    description: describe("comments_reply"),
    inputSchema: toStandardJsonSchema(
      v.object({
        id: thread,
        body: v.pipe(v.string(), v.minLength(1), v.maxLength(4000), v.description("The reply, in plain words.")),
      }),
    ),
    handler: (input, event) => run("comments_reply", input, event),
  }),
  defineMcpTool({
    name: "comments_resolve_thread",
    title: tools.get("comments_resolve_thread")!.title,
    description: describe("comments_resolve_thread"),
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
