import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { defineMcpPrompt } from "nitro-mcp-toolkit"
import * as v from "valibot"

export default defineMcpPrompt({
  name: "address_feedback",
  title: "Address review feedback",
  description: "Read the open comments on a drop and publish the next version that addresses them.",
  inputSchema: toStandardJsonSchema(v.object({ id: v.pipe(v.string(), v.description("Drop id from list_drops.")) })),
  handler: ({ id }) => `Call list_comments for drop ${id} and read_drop for its current content. Address every open comment, then publish the next version: create_doc with supersedes "${id}" for a doc, or publish_app with id "${id}" for an app. Reply with the new link and a one-line summary per comment.`,
})
