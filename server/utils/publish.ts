import { type H3Event, HTTPError } from "h3"
import * as v from "valibot"
import { AgentMetadataSchema } from "#shared/agent"
import { LIFETIMES, MAX_KEEP_REASON } from "#shared/expiry"
import { MAX_SLUG, slugify } from "#shared/links"
import { appLinkIssues } from "#shared/project-bundle"
import { reviewBookmarklet, reviewSnippet } from "#shared/review"
import { SHARES } from "#shared/share"
import { BoardInput } from "../mcp/board"
import { dropLine, mcpDrop, SHARE_INPUT } from "../mcp/format"
import { applyChanges, boardChanges, emptyBoard, serializeBoard } from "#shared/board"
import { resolveComments } from "./comments"
import { createDocDrop, findDrop, findDropByRef, MAX_FILE_BYTES, permissions, publishApp, toSummary } from "./drops"
import { updateDrop } from "./drop-update"
import { requireFolder } from "./folders"
import type { Identity } from "./identity"
import { problemLine } from "./markdown-document"
import { createSiteDrop } from "./review"
import { unpackApp } from "./app-archive"
import { perDropOrigins } from "./content-origin"
import { addedResources, resourceList, ResourcesInput, saveResources } from "./resources"
import { signUpload } from "./uploads"

// No v.trim() or other transformations: they can't become JSON Schema, and tools/list publishes every input schema.
export const PublishInput = v.object({
  agent: v.optional(
    v.pipe(
      AgentMetadataSchema,
      v.description(
        "Your model, harness, and reasoning level for this publish. Report known values from your runtime; omit unknown fields. Supplied separately on every version, never inherited.",
      ),
    ),
  ),
  markdown: v.optional(v.pipe(v.string(), v.maxLength(MAX_FILE_BYTES), v.description("A doc in Markdown."))),
  html: v.optional(v.pipe(v.string(), v.maxLength(MAX_FILE_BYTES), v.description("A self-contained HTML page."))),
  files: v.optional(
    v.pipe(
      v.record(v.string(), v.string()),
      v.description(
        `A small hand-written static app: path to UTF-8 contents, with an index.html, at most ${MAX_FILE_BYTES} bytes in all. With previous, send only the files that changed; every other file carries over. For a built app (a dist/ folder), use archive.`,
      ),
    ),
  ),
  archive: v.optional(
    v.pipe(
      v.object({}),
      v.description(
        "A built static app, such as a dist/ folder with its index.html at the top, binary files (fonts, images, wasm) included. Pass {} and you get an uploadUrl: upload the folder with `tar -czf - -C <folder> . | curl -T - '<uploadUrl>'`, which publishes it and prints the drop. It replaces every file of the app, so with previous upload the whole folder again.",
      ),
    ),
  ),
  removes: v.optional(
    v.pipe(
      v.array(v.string()),
      v.maxLength(200),
      v.description(
        "With previous and an app: paths to delete from it. A file leaves an app only when it's named here. Pass files: {} to only delete.",
      ),
    ),
  ),
  file: v.optional(
    v.pipe(
      v.object({
        name: v.pipe(v.string(), v.description("File name with its extension, e.g. before.png.")),
        base64: v.optional(
          v.pipe(
            v.string(),
            v.maxLength(Math.ceil(MAX_FILE_BYTES / 3) * 4 + 1024),
            v.description(
              "The file's bytes, base64-encoded. Only for small files you already hold as text. For a file on disk, such as a screenshot, leave it out.",
            ),
          ),
        ),
      }),
      v.description(
        "Any other file up to 4 MiB: a screenshot, a PDF. Images get pin and area comments. Embed its fileUrl in a doc to make it part of that doc. Without base64 you get an uploadUrl: upload the file with `curl -T <path> '<uploadUrl>'`, which creates the drop and prints it with its fileUrl.",
      ),
    ),
  ),
  site: v.optional(
    v.pipe(
      v.object({
        url: v.pipe(
          v.string(),
          v.maxLength(300),
          v.description(
            "The address people review: one origin like https://pr123.preview.example.com, or a pattern like https://*.preview.example.com, where * stands for one label, so one site drop covers every pull request's preview. https, or http on localhost.",
          ),
        ),
      }),
      v.description(
        "A live website to review in place, such as a preview deploy, staging, or a dev server. People comment on its pages with a bookmarklet, or a script tag in preview builds; their comments arrive here with screenshots.",
      ),
    ),
  ),
  board: v.optional(BoardInput),
  title: v.optional(v.string()),
  slug: v.optional(
    v.pipe(
      v.string(),
      v.minLength(1),
      v.maxLength(MAX_SLUG),
      v.description(
        "The readable part of the drop's link, like hipoteca-madrid: a few lowercase words and dashes that say what it is. Pick one for every new drop. Later versions keep it unless you pass another; old links keep working.",
      ),
    ),
  ),
  previous: v.optional(
    v.pipe(
      v.string(),
      v.description(
        "Id or link of the drop this publishes the next version of. It keeps that drop's sharing, lifetime and link unless you pass them. Its link then opens the new version.",
      ),
    ),
  ),
  note: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(500),
    v.description("What this version is or what changed, like a commit message. People see it in the version history."),
  ),
  lifetime: v.optional(
    v.pipe(
      v.picklist(LIFETIMES),
      v.description(
        "Required for a new drop. temporary: prototypes and one-off answers, gone 14 days after the last visit. review: docs going through feedback, 30 days. keep: never expires, for pull request assets and anything linked from somewhere lasting; needs keepReason.",
      ),
    ),
  ),
  keepReason: v.optional(
    v.pipe(
      v.string(),
      v.maxLength(MAX_KEEP_REASON),
      v.description(
        "Why it should be kept, in a sentence or two (e.g. the pull request it belongs to). The owner sees it.",
      ),
    ),
  ),
  share: v.optional(v.pipe(v.picklist(SHARES), v.description(SHARE_INPUT))),
  resolves: v.optional(
    v.pipe(
      v.array(v.pipe(v.number(), v.integer())),
      v.maxLength(90),
      v.description(
        "Numbers of the open comments this version addresses, from read_drop on previous. Comments written on earlier versions count too. They're marked resolved.",
      ),
    ),
  ),
  resources: v.optional(
    v.pipe(
      ResourcesInput,
      v.description(
        "Links the drop belongs with, shown with their sites' icons at the top of its page: the pull request it documents, that PR's preview deploy, the issue. Every version shows the same ones. With previous, these are added to the drop's links; one already there keeps its place, so pass them again freely. Replace or clear them with update_drop.",
      ),
    ),
  ),
  folder: v.optional(
    v.pipe(
      v.string(),
      v.description(
        "Id or link of the folder to put the drop in: the one list_folders describes as the place for it. It then shares and lives with the folder, so it needs no lifetime. Leave it out when no folder fits; the drop goes at the top. With previous, moves the drop there.",
      ),
    ),
  ),
})

export type PublishInput = v.InferOutput<typeof PublishInput>

/**
 * One `publish` call: what the MCP tool does, and what an upload URL finishes. `upload` carries the bytes of a file or
 * an app's archive sent to that URL; without them, a file with no base64, or an archive, gets an upload URL instead of
 * a drop, after the same checks.
 */
export async function publishInput(who: Identity, input: PublishInput, event: H3Event, upload?: Uint8Array) {
  const given = (["markdown", "html", "files", "archive", "file", "site", "board"] as const).filter(
    (key) => input[key] !== undefined,
  )
  if (given.length !== 1)
    throw new HTTPError({
      status: 400,
      message: "Pass exactly one of markdown, html, files, archive, file, site, or board.",
    })
  if (!input.previous && !input.folder && !input.lifetime)
    throw new HTTPError({
      status: 400,
      message: "Say how long this drop should live: lifetime temporary, review, or keep.",
    })
  const folder = input.folder && !input.previous ? await requireFolder(input.folder, who, event) : undefined
  if (input.slug !== undefined && !slugify(input.slug))
    throw new HTTPError({ status: 400, message: "Use letters or numbers in the slug." })
  const links = input.resources ? resourceList(input.resources) : undefined
  // The upload URL carries the call, and room in it is short.
  if (links && input.file && input.file.base64 === undefined && !upload)
    throw new HTTPError({
      status: 400,
      message: "Put resources on the doc that embeds the file, or set them with update_drop once it's uploaded.",
    })
  if (input.site) {
    if (input.previous || input.resolves || input.removes)
      throw new HTTPError({
        status: 400,
        message: "A site has no versions. Change it with update_drop, and resolve its comments there.",
      })
    const resources = links && addedResources(null, links)
    const row = await createSiteDrop(
      who,
      {
        url: input.site.url,
        title: input.title,
        slug: input.slug,
        folder,
        share: input.share,
        lifetime: input.lifetime,
        keepReason: input.keepReason,
        note: input.note,
        agent: input.agent,
      },
      event,
    )
    if (resources) await saveResources(row, resources)
    const drop = mcpDrop(toSummary((await findDrop(row.id, event)) ?? row), event.url.origin)
    const script = reviewSnippet(event.url.origin)
    return {
      text: `Created a site review:\n${dropLine(drop)}\n\nPeople review ${row.siteUrl} with the "Review with Drop" bookmarklet on the drop's page; the site needs no change. To show the Comment button without it, add this tag to the site's preview builds only, never production. It carries no key:\n${script}\n\nComments sent from ${row.siteUrl} land on the drop; read them with read_drop.`,
      result: { ...drop, siteUrl: row.siteUrl!, script, bookmarklet: reviewBookmarklet(event.url.origin) },
    }
  }
  let previous = input.previous ? await findDropByRef(input.previous, event) : null
  if (previous?.expired && permissions(previous, who).manage)
    throw new HTTPError({
      status: 409,
      message: `${input.previous} is in the Trash. Restore it with update_drop first, or publish a new drop.`,
    })
  if (input.previous && (!previous || !permissions(previous, who).edit))
    throw new HTTPError({ status: 404, message: `No drop you can publish to with id ${input.previous}.` })
  if (previous?.kind === "site")
    throw new HTTPError({
      status: 400,
      message: "previous is a site, which has no versions. Change it with update_drop.",
    })
  // An earlier version (a `?v=` link) names the drop too; the next version goes on top of the latest.
  if (previous?.head) previous = await findDrop(previous.id, event)
  const resources = links && addedResources(previous, links)
  const share = input.share ? { share: input.share } : {}
  const life = { lifetime: input.lifetime, keepReason: input.keepReason, note: input.note, agent: input.agent }

  let row
  let warnings: string[] = []
  if (input.files || input.archive) {
    if (previous && previous.kind !== "app")
      throw new HTTPError({ status: 400, message: "previous is a doc; publish files only to an app." })
    if (input.archive && !perDropOrigins(event))
      throw new HTTPError({
        status: 400,
        message:
          "This Drop can't serve built apps: each needs an origin of its own (a DROP_CONTENT_ORIGIN with a *). Publish a small app with files instead.",
      })
    if (input.archive && input.removes)
      throw new HTTPError({
        status: 400,
        message: "An archive replaces the whole app: leave removes out and upload the whole folder.",
      })
    if (input.archive && !upload) {
      // The checks above passed, so the upload will too unless something changes in the meantime; it runs them again.
      const { url, expiresAt } = await signUpload(event, who, input)
      return {
        text: `Upload the built folder within 15 minutes, once:\ntar -czf - -C <folder> . | curl -T - '${url}'\nIt publishes the app and prints it as JSON, with any warnings.`,
        result: { uploadUrl: url, method: "PUT" as const, expiresAt: new Date(expiresAt).toISOString() },
      }
    }
    row = await publishApp(
      who,
      {
        id: previous?.id,
        name: input.title,
        slug: input.slug,
        files: input.archive ? await unpackApp(upload!) : input.files!,
        removes: input.removes,
        replace: !!input.archive,
        folder,
        ...share,
        ...life,
      },
      event,
    )
    warnings = row.warnings
  } else {
    if (previous?.kind === "app")
      throw new HTTPError({ status: 400, message: "previous is an app; publish its next version with files." })
    if (input.removes) throw new HTTPError({ status: 400, message: "removes only applies to apps." })
    let filename: string, bytes: Uint8Array
    if (input.file) {
      filename = input.file.name
      if (upload) bytes = upload
      else if (input.file.base64 === undefined) {
        // The checks above passed, so the upload will too unless something changes in the meantime; it runs them again.
        const { url, expiresAt } = await signUpload(event, who, input)
        return {
          text: `Upload ${filename} within 15 minutes, once:\ncurl -T <path to ${filename}> '${url}'\nIt creates the drop and prints it as JSON, with fileUrl to embed in a doc.`,
          result: { uploadUrl: url, method: "PUT" as const, expiresAt: new Date(expiresAt).toISOString() },
        }
      } else {
        try {
          bytes = Uint8Array.from(atob(input.file.base64.replace(/\s+/g, "")), (char) => char.charCodeAt(0))
        } catch {
          throw new HTTPError({ status: 400, message: "file.base64 isn't valid base64." })
        }
      }
    } else if (input.board) {
      if (previous && previous.kind !== "board")
        throw new HTTPError({ status: 400, message: "previous isn't a board; publish a board only to a board." })
      const board = emptyBoard()
      try {
        const { put } = boardChanges(board, { add: input.board.items, edges: input.board.edges }, who.actorName)
        applyChanges(board, put)
      } catch (error) {
        throw new HTTPError({ status: 400, message: error instanceof Error ? error.message : String(error) })
      }
      filename = "board.excalidraw"
      bytes = new TextEncoder().encode(serializeBoard(board))
    } else {
      const source = (input.markdown ?? input.html)!
      if (!source.trim()) throw new HTTPError({ status: 400, message: "The doc is empty." })
      // An HTML doc is one file, so anything it loads by relative path is missing.
      if (input.html)
        warnings = appLinkIssues({ "doc.html": input.html }, ["doc.html"]).filter(
          (issue) => !issue.startsWith("doc.html links to"),
        )
      filename = input.html ? "doc.html" : "doc.md"
      bytes = new TextEncoder().encode(source)
    }
    // Markdown and HTML sent as text are named after the link's slug; a file keeps its own name.
    row = await createDocDrop(
      who,
      {
        filename,
        bytes,
        title: input.title,
        slug: input.slug,
        nameFromSlug: !input.file,
        supersedes: previous?.id,
        folder,
        ...share,
        ...life,
      },
      event,
    )
    // createDocDrop refused a Markdown doc with errors (requirePublishableMarkdown); these are what it published with.
    if (row.warnings.length) warnings = row.warnings.map(problemLine)
    // The share and the slug apply to every version, like a change on the drop's page.
    if (previous && (input.share || input.slug))
      await updateDrop(
        (await findDrop(row.id, event))!,
        who,
        { ...share, ...(input.slug ? { slug: input.slug } : {}) },
        event,
      )
  }
  if (previous && input.folder) await updateDrop((await findDrop(row.id, event))!, who, { folder: input.folder }, event)

  // Comments carry over from earlier versions (listComments), so this looks across all of them.
  const resolved = previous && input.resolves?.length ? await resolveComments(previous, input.resolves) : []

  const fresh = (await findDrop(row.id, event)) ?? row
  if (resources) await saveResources(fresh, resources)
  const drop = mcpDrop(toSummary(fresh), event.url.origin, fresh)
  const result = { ...drop, ...(resolved.length ? { resolved } : {}), ...(warnings.length ? { warnings } : {}) }
  const lead = input.markdown
    ? "It published with these Comark lint warnings."
    : `These references point at nothing in the ${input.files ? "app" : "page"}.`
  const check = warnings.length
    ? `\n\n${lead} Fix them and publish again with previous:\n${warnings.map((warning) => `- ${warning}`).join("\n")}`
    : ""
  return {
    text: `Published${drop.version > 1 ? ` v${drop.version}` : ""}${resolved.length ? `, resolved ${resolved.map((n) => `#${n}`).join(", ")}` : ""}:\n${dropLine(drop)}${check}`,
    result,
  }
}
