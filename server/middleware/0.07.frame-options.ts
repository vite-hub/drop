import { defineHandler } from "h3"

export default defineHandler((event) => {
  event.res.headers.set("X-Frame-Options", "DENY")
})
