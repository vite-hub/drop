import { defineHandler } from "h3"

// Files moved from /i/ to /f/. Old links (agents pasted them into PRs and docs) keep working, query and all.
export default defineHandler(event => new Response(null, {
  status: 301,
  headers: { location: `/f/${event.url.pathname.slice(3)}${event.url.search}` },
}))
