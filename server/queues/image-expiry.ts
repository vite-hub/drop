import { blob } from "@vite-hub/blob"
import { defineQueue } from "@vite-hub/queue"

interface ImageExpiryPayload {
  key: string
}

const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/

export default defineQueue<ImageExpiryPayload>(async ({ payload }) => {
  if (!payload || !keyPattern.test(payload.key)) {
    console.error(JSON.stringify({ counter: "expiry_invalid_payload" }))
    return
  }

  try {
    await blob.del(payload.key)
  }
  catch (error) {
    console.error(JSON.stringify({ counter: "expiry_failure", error: error instanceof Error ? error.message : String(error), key: payload.key }))
    throw error
  }
})
