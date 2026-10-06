import { defineHandler } from "h3"
import { listDrops } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"

export default defineHandler(async event => listDrops(await requireIdentity(event)))
