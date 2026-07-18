import { defineHandler, setResponseHeader } from "h3"
import { kv } from "vite-hub/kv"

export default defineHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "public, max-age=60")

  return { uploads: await kv.get<number>("uploads") ?? 0 }
})
