import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { defineMcpTool } from "nitro-mcp-toolkit"
import { PNG_CODE_IMAGES } from "#code-image-png"
import { CodeImageSchema } from "#shared/schemas"
import { createCodeImage } from "../../utils/code-image-store"
import { requireIdentity } from "../../utils/identity"

export default defineMcpTool({
  name: "create_code_image",
  title: "Create a code image",
  description: `Render source code as ${PNG_CODE_IMAGES ? "a PNG (the default) or SVG image" : "an SVG image (this Drop can't render PNG)"} with syntax highlighting. Returns a public URL that expires after five minutes: download it, or drop it to keep it.`,
  inputSchema: toStandardJsonSchema(CodeImageSchema),
  handler: async (input, event) => {
    const { url, expiresAt } = await createCodeImage(event, await requireIdentity(event), input)
    return `${url} (expires ${expiresAt})`
  },
})
