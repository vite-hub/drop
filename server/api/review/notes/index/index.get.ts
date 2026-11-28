import { defineHandler } from "h3"
import { notesCaller, notesIndex } from "../../../../utils/notes"

export default defineHandler(async (event) => {
  const who = await notesCaller(event)
  const { body, etag } = await notesIndex(who)
  event.res.headers.set("Cache-Control", "private, no-cache")
  event.res.headers.set("ETag", etag)
  if (event.req.headers.get("if-none-match") === etag) return new Response(null, { status: 304 })
  return new Response(body, { headers: { "Content-Type": "application/json" } })
})
