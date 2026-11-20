import { defineHandler, getRouterParam } from "h3"
import { dropMarkdownResponse } from "../../../utils/drop-markdown"

/** `/d/<link>/<slug>.md`: the doc of a share link as Markdown. */
export default defineHandler((event) => dropMarkdownResponse(event, getRouterParam(event, "link")!))
