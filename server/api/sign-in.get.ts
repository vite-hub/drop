import { defineHandler } from "h3"
import { authProxy } from "../utils/proxy-auth"

export default defineHandler(() => ({ proxy: authProxy().enabled }))
