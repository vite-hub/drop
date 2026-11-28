import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { defineMcpTool } from "nitro-mcp-toolkit"
import { requireIdentity } from "../../utils/identity"
import { publishInput, PublishInput } from "../../utils/publish"
import { quotaToolResult } from "../../utils/quotas"

export default defineMcpTool({
  name: "publish",
  title: "Publish a drop",
  description:
    "Publish one thing for review: a doc (markdown or html, or a .md or .html file on disk uploaded with file), a static app (files for a small one, archive for a built folder such as dist/), a file such as a screenshot (file), or a live website reviewed in place (site), or a whiteboard people draw on together (board). Before publishing something new, read list_folders and pass the folder whose description fits it; with none that fits, leave folder out. Pass previous to publish a doc's or app's next version, with base set to the version you read: if someone published since, the call fails with a conflict and you read the drop again. An app's reply lists its pages, each with a link that opens the drop at that page (?path=): send the one the reviewer should look at. A Markdown doc with images (screenshots, cards) passes images with each file name and writes each as ./<name>, as in ![alt](./A.png): one publish attaches up to 30, which live and expire with the doc, and the reply lists an uploadUrl for each to send with curl -T. Pass agent with your known model, harness, and reasoningLevel for this publish, and session with the identifiers of the session you publish from (harness, thread, project, worktree, branch); omit unknown values. Every call creates a drop or a version, so don't repeat a call that succeeded.",
  inputSchema: toStandardJsonSchema(PublishInput),
  handler: async (input, event) =>
    quotaToolResult(async () => {
      const { text, result } = await publishInput(await requireIdentity(event), input, event)
      return { content: [{ type: "text" as const, text }], structuredContent: result }
    }),
})
