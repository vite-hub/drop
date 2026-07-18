import * as v from "valibot"

// Extension keys remain valid until images created before the bare-UUID rollout expire.
export const imageKeySchema = v.union([
  v.pipe(v.string(), v.uuid()),
  v.pipe(v.string(), v.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/)),
])
