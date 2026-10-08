import { defineHandler } from "h3"
import { requireIdentity } from "../utils/identity"
import { getUsage } from "../utils/quotas"

export default defineHandler(async event => getUsage((await requireIdentity(event)).userId))
