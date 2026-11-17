import { defineMiddleware } from "h3"
import { authRequest } from "../utils/logs"

/** Better Auth's hooks in server/auth.ts reach the request through this (server/utils/logs.ts `authRequest`). */
export default defineMiddleware((event, next) => authRequest.run(event, next))
