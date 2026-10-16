import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { defineMcpPrompt } from "nitro-mcp-toolkit"
import * as v from "valibot"

export default defineMcpPrompt({
  name: "address_feedback",
  title: "Address review feedback",
  description: "Read the open comments on a drop and publish the next version that addresses them.",
  inputSchema: toStandardJsonSchema(v.object({ id: v.pipe(v.string(), v.description("Drop id from list_drops.")) })),
  handler: ({ id }) => `Call read_drop for drop ${id} to get its content and open comments. Address every open comment, then publish the next version with previous "${id}", a note saying what changed, and resolves listing the comments you addressed. Reply with the new link and a one-line summary per comment.`,
})
