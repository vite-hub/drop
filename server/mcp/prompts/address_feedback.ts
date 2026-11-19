import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { defineMcpPrompt } from "nitro-mcp-toolkit"
import * as v from "valibot"

export default defineMcpPrompt({
  name: "address_feedback",
  title: "Address review feedback",
  description: "Read the open comments on a drop and publish the next version that addresses them.",
  inputSchema: toStandardJsonSchema(v.object({ id: v.pipe(v.string(), v.description("Drop id from list_drops.")) })),
  handler: ({ id }) =>
    `Call read_drop for drop ${id} to get its content and open comments. Accept the suggestions that are right as written with accept_suggestion, one call each, before anything else. If feedback remains after accepting suggestions, call read_drop again after the last acceptance. Address the remaining open comments using the returned content. If edits are needed, publish the next version with previous "${id}", base set to the version returned by your latest read_drop, a note saying what changed, and resolves listing the comments addressed by that publish. If no edits remain, do not publish again. Reply with the resulting link and a one-line summary per comment.`,
})
