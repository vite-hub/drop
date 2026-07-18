import { blob } from "vite-hub/blob"
import { defineQueue } from "vite-hub/queue"
import * as v from "valibot"

import { imageKeySchema } from "../image-key"

export default defineQueue<{key: string}>(async ({ payload }) => {
  if (!v.is(v.object({ key: imageKeySchema }), payload)) {
    return console.error(JSON.stringify({ counter: "expiry_invalid_payload" }))
  }

  try {
    await blob.del(payload.key)
  }
  catch (error) {
    console.error(JSON.stringify({ counter: "expiry_failure", error: error instanceof Error ? error.message : String(error), key: payload.key }))
    throw error
  }
})
