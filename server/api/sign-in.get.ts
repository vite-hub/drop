import { defineHandler } from "h3"
import { authProxy } from "../utils/proxy-auth"

/** How the sign-in page starts sign-in: Drop's own GitHub flow, or the oauth2-proxy in front of it. */
export default defineHandler(() => ({ proxy: authProxy().enabled }))
