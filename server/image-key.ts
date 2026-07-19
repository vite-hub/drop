import * as v from "valibot"

export const imageKeySchema = v.pipe(v.string(), v.uuid())
