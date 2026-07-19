import { defineHandler, setResponseHeaders } from "h3"
import { kv } from "vite-hub/kv"

export default defineHandler(async (event) => {
  setResponseHeaders(event, { "Cache-Control": "public, max-age=300" })
  return { uploads: await kv.get<number>("uploads") ?? 0 }
})
