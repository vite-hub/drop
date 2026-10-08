import { defineHandler } from "h3"
export default defineHandler(event => {
  event.res.headers.set("Content-Type", "text/plain; charset=utf-8")
  return "User-agent: *\nDisallow: /f/\nDisallow: /d/\n"
})
