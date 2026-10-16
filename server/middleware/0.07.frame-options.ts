import { defineHandler } from "h3"

/**
 * No other site may frame Drop: a hidden frame could take the click on "Allow" (/oauth), "Share", or a member's role.
 * Drop frames only the content origin, which answered before this runs, and srcdoc documents, which have no URL.
 * X-Frame-Options instead of a CSP, so it never replaces the policies /f/ documents set for themselves.
 */
export default defineHandler((event) => {
  event.res.headers.set("X-Frame-Options", "DENY")
})
