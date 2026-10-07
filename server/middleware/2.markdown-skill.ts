import { defineHandler } from "h3"

/** `GET /` with `Accept: text/markdown` answers with the skill, so an agent fetching the site learns the API. */
export default defineHandler(async (event) => {
  if (event.req.method !== "GET" || event.url.pathname !== "/") return

  event.res.headers.append("Vary", "Accept")

  if (event.req.headers.get("accept")?.includes("text/markdown")) {
    // Loaded lazily: middleware lands in the Worker's entry module, which may only export handlers.
    const { findSkill } = await import("../utils/skills")
    event.res.headers.set("Content-Type", "text/markdown; charset=utf-8")
    return findSkill("vitehub-drop")!.files[0]!.text
  }
})
