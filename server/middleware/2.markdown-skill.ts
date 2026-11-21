import { defineHandler } from "h3"

export default defineHandler(async (event) => {
  if (event.req.method !== "GET" || event.url.pathname !== "/") return

  event.res.headers.append("Vary", "Accept")

  if (event.req.headers.get("accept")?.includes("text/markdown")) {
    const { findSkill } = await import("../utils/skills")
    event.res.headers.set("Content-Type", "text/markdown; charset=utf-8")
    return findSkill("vitehub-drop")!.files[0]!.text
  }
})
