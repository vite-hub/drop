import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { defineMcpTool } from "nitro-mcp-toolkit"
import { CodeImageSchema } from "#shared/schemas"
import { createCodeImage } from "../../utils/code-image-store"
import { requireIdentity } from "../../utils/identity"

export default defineMcpTool({
  name: "create_code_image",
  title: "Create a code image",
  description: "Render source code as a PNG or SVG image with syntax highlighting. Returns a public URL that expires after five minutes: download it, or drop it to keep it.",
  inputSchema: toStandardJsonSchema(CodeImageSchema),
  handler: async (input, event) => {
    const { url, expiresAt } = await createCodeImage(event, await requireIdentity(event), input)
    return `${url} (expires ${expiresAt})`
  },
})
