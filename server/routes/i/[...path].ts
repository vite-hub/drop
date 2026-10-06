import { defineHandler, redirect } from "h3"

// Files moved from /i/ to /f/. Old links (agents pasted them into PRs and docs) keep working, query and all.
export default defineHandler(event => redirect(`/f/${event.url.pathname.slice(3)}${event.url.search}`, 301))
