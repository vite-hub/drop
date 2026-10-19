import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { HTTPError } from "h3"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { LIFETIMES, MAX_KEEP_REASON } from "#shared/expiry"
import { MAX_SLUG, slugify } from "#shared/links"
import { findDrop, toSummary } from "../../utils/drops"
import { SHARES } from "#shared/share"
import { createFolder, MAX_FOLDER_DESCRIPTION, requireFolder } from "../../utils/folders"
import { requireIdentity } from "../../utils/identity"
import { quotaToolResult } from "../../utils/quotas"
import { dropLine, mcpDrop, SHARE_INPUT } from "../format"

// No v.trim() or other transformations: they can't become JSON Schema (see publish.ts).
export default defineMcpTool({
  name: "create_folder",
  title: "Create a folder",
  description:
    "Create a folder of the user's own to keep drops that belong together, such as the screenshots and notes of one review. Check list_folders first: the team's folders, which only admins make in the browser, may already have a place for it. Publish into it with publish folder; list_drops with folder searches only inside it. Sharing the folder shares everything in it, and everything in it lives as long as the folder.",
  inputSchema: toStandardJsonSchema(
    v.object({
      title: v.pipe(v.string(), v.minLength(1), v.maxLength(160)),
      slug: v.optional(
        v.pipe(
          v.string(),
          v.minLength(1),
          v.maxLength(MAX_SLUG),
          v.description("The readable part of the folder's link: lowercase words and dashes."),
        ),
      ),
      folder: v.optional(
        v.pipe(
          v.string(),
          v.description(
            "Id or link of the folder to create this one in. It then shares and lives with that folder, so it needs no lifetime.",
          ),
        ),
      ),
      lifetime: v.optional(
        v.pipe(
          v.picklist(LIFETIMES),
          v.description(
            "Required at the top: temporary (14 days after the last visit to anything in it), review (30 days), or keep (never expires; needs keepReason).",
          ),
        ),
      ),
      keepReason: v.optional(
        v.pipe(v.string(), v.maxLength(MAX_KEEP_REASON), v.description("Why it should be kept, in a sentence or two.")),
      ),
      share: v.optional(v.pipe(v.picklist(SHARES), v.description(SHARE_INPUT))),
      description: v.optional(
        v.pipe(
          v.string(),
          v.maxLength(MAX_FOLDER_DESCRIPTION),
          v.description(
            "What goes in the folder and how (what to name things, what to write), so later agents pick it from list_folders.",
          ),
        ),
      ),
    }),
  ),
  handler: async ({ title, slug, folder, lifetime, keepReason, share, description }, event) =>
    quotaToolResult(async () => {
      const who = await requireIdentity(event)
      if (!title.trim()) throw new HTTPError({ status: 400, message: "Name the folder." })
      if (slug !== undefined && !slugify(slug))
        throw new HTTPError({ status: 400, message: "Use letters or numbers in the slug." })
      if (!folder && !lifetime)
        throw new HTTPError({
          status: 400,
          message: "Say how long this folder should live: lifetime temporary, review, or keep.",
        })
      const parent = folder ? await requireFolder(folder, who, event, undefined, "folder") : undefined
      const row = await createFolder(
        who,
        { title, slug, folder: parent, lifetime, keepReason, note: description, share },
        event,
      )
      const drop = mcpDrop(toSummary((await findDrop(row.id, event)) ?? row), event.url.origin)
      return { content: [{ type: "text" as const, text: `Created:\n${dropLine(drop)}` }], structuredContent: drop }
    }),
})
