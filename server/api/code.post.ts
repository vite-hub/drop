import { defineValidatedHandler } from "h3"
import { CodeImageSchema } from "#shared/schemas"
import { createCodeImage } from "../utils/code-image-store"
import { requireIdentity } from "../utils/identity"

export default defineValidatedHandler({
  validate: { body: CodeImageSchema },
  async handler(event) {
    return createCodeImage(event, await requireIdentity(event), await event.req.json())
  },
})
