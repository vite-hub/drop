import { defineHandler } from "h3"
import skill from "../../skills/vitehub-drop/SKILL.md?raw"

export default defineHandler((event) => {
  if (event.req.method !== "GET" || event.url.pathname !== "/") return

  event.res.headers.append("Vary", "Accept")

  if (event.req.headers.get("accept")?.includes("text/markdown")) {
    event.res.headers.set("Content-Type", "text/markdown; charset=utf-8")
    return skill
  }

  return
})
