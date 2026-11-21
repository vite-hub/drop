import { defineHandler, getRouterParam } from "h3"
import { dropMarkdownResponse } from "../../utils/drop-markdown"

/** `/d/<link>.md`: the doc of a link without its slug, as Markdown. */
export default defineHandler((event) => dropMarkdownResponse(event, getRouterParam(event, "link")!))
