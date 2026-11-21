import { defineMiddleware } from "h3"
import { authRequest } from "../utils/logs"

export default defineMiddleware((event, next) => authRequest.run(event, next))
