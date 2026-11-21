import { defineHandler, getRouterParam } from "h3"
import { dropMarkdownResponse } from "../../../utils/drop-markdown"

export default defineHandler((event) => dropMarkdownResponse(event, getRouterParam(event, "link")!))
