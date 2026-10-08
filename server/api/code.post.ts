import { defineValidatedHandler } from "h3"
import { CodeImageSchema } from "#shared/schemas"
import { createCodeImage } from "../utils/code-image-store"
import { requireIdentity } from "../utils/identity"
import { quotaApiHandler } from "../utils/quotas"

/** Turns code into an image for the browser; agents use the `create_code_image` MCP tool. */
export default quotaApiHandler(defineValidatedHandler({
  validate: { body: CodeImageSchema },
  async handler(event) {
    return createCodeImage(event, await requireIdentity(event), await event.req.json())
  },
}))
