import { readFileSync } from "node:fs"
import { parseJSONC } from "confbox"
import * as v from "valibot"

// Loose: only the fields Drop reads are checked. ViteHub merges the rest of wrangler.jsonc into the generated config.
const Template = v.looseObject({
  name: v.string(),
  d1_databases: v.array(v.looseObject({ database_id: v.optional(v.string()), database_name: v.string() })),
})

export const cloudflareTemplate = v.parse(
  Template,
  parseJSONC(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")),
)
