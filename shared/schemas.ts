// Request bodies, defined once. Server routes validate with them (readValidatedBody) and forms reuse them
// (UForm :schema), so a field's rules and messages are the same on both sides.
import * as v from "valibot"
import { LIFETIMES, MAX_KEEP_REASON } from "./expiry"
import { MAX_SLUG, slugify } from "./links"
import { MAX_APP_BYTES } from "./quotas"
import { MAX_REVIEW_PAGE, SITE_ADDRESS_RULE, siteAddress } from "./review"
import { SHARES } from "./share"

/** 4 MiB: the most one file (or one app) may weigh. */
export const MAX_FILE_BYTES = MAX_APP_BYTES

export const NewDocSchema = v.object({
  filename: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  content: v.pipe(v.string(), v.maxLength(MAX_FILE_BYTES, "The file exceeds the 4 MiB limit.")),
  title: v.optional(v.string()),
  supersedes: v.optional(v.string()),
})

export const DropPatchSchema = v.object({
  /** Who can open it, as one state (#shared/share). */
  share: v.optional(v.picklist(SHARES)),
  /** Folders: what goes in them and how, which agents read to pick the folder. Empty clears it. */
  description: v.optional(v.pipe(v.string(), v.maxLength(2000, "Keep the description under 2,000 characters."))),
  title: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(160))),
  /** The readable part of the link, for every version. The link keeps working with the old one. */
  slug: v.optional(v.pipe(v.string(), v.maxLength(MAX_SLUG), v.check(value => slugify(value) !== "", "Use letters or numbers in the slug."))),
  lifetime: v.optional(v.picklist(LIFETIMES)),
  /** Required when an agent keeps a drop. */
  keepReason: v.optional(v.pipe(v.string(), v.maxLength(MAX_KEEP_REASON, `Keep the reason under ${MAX_KEEP_REASON} characters.`))),
  /** Start a fresh expiry window. */
  renew: v.optional(v.literal(true)),
  /** True moves the drop to the Trash; false restores it with a fresh window. */
  trashed: v.optional(v.boolean()),
  /** The folder to move the drop into (its id or link), or null to move it to the top. */
  folder: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(600)))),
})

export const FolderSchema = v.object({
  title: v.pipe(v.string(), v.trim(), v.minLength(1, "Name the folder."), v.maxLength(160)),
  /** What goes in it and how, for people and the agents that publish into it. */
  description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000, "Keep the description under 2,000 characters."))),
  /** A team folder: on a team Drop, admins only. */
  team: v.optional(v.boolean()),
  /** The folder to create it in, by id or link. */
  folder: v.optional(v.pipe(v.string(), v.maxLength(600))),
})

export const AppSchema = v.object({
  id: v.optional(v.string()),
  name: v.optional(v.pipe(v.string(), v.maxLength(160))),
  /** The readable part of its link. Later versions keep it unless they pass another. */
  slug: v.optional(v.pipe(v.string(), v.maxLength(MAX_SLUG))),
  /** With `id`, only the files that changed: the rest carry over from the previous version. */
  files: v.record(v.string(), v.string()),
  /** Paths to delete from the previous version. A file leaves an app only when it's named here. */
  removes: v.optional(v.pipe(v.array(v.string()), v.maxLength(200))),
})

const thousandths = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000))

/**
 * Positions are thousandths of the anchor's box; `ow`/`oh` size an area and default to 0, a point. A `page` comment is
 * about the page as a whole: no anchor, an empty selector, and zero positions.
 */
export const CommentSchema = v.pipe(
  v.object({
    kind: v.picklist(["text", "image", "area", "page"]),
    selector: v.pipe(v.string(), v.maxLength(2000)),
    ox: thousandths,
    oy: thousandths,
    ow: v.optional(thousandths, 0),
    oh: v.optional(thousandths, 0),
    quote: v.optional(v.pipe(v.string(), v.maxLength(2000))),
    label: v.optional(v.pipe(v.string(), v.maxLength(200))),
    page: v.optional(v.pipe(v.string(), v.maxLength(300))),
    body: v.pipe(v.string(), v.trim(), v.minLength(1, "Write a comment."), v.maxLength(4000)),
  }),
  v.check(input => input.ox + input.ow <= 1000 && input.oy + input.oh <= 1000, "The area must stay inside its anchor."),
  v.check(input => input.kind !== "area" || (input.ow > 0 && input.oh > 0), "An area needs a width and a height."),
  v.check(input => input.kind !== "page" || (!input.selector && !input.ox && !input.oy && !input.ow && !input.oh && !input.quote), "A comment on the whole page points at nothing in it."),
)

/**
 * What a site's review script sends with a comment. All of it comes from someone else's page, so every field is
 * bounded. The box is in thousandths of the viewport, which is also the screenshot.
 */
export const ReviewCommentSchema = v.pipe(
  v.object({
    body: v.pipe(v.string(), v.trim(), v.minLength(1, "Write a comment."), v.maxLength(4000)),
    page: v.pipe(v.string(), v.startsWith("/"), v.maxLength(MAX_REVIEW_PAGE)),
    selector: v.optional(v.pipe(v.string(), v.maxLength(2000)), ""),
    label: v.optional(v.pipe(v.string(), v.maxLength(200))),
    ox: thousandths,
    oy: thousandths,
    ow: thousandths,
    oh: thousandths,
    viewport: v.object({
      width: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20_000)),
      height: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20_000)),
    }),
  }),
  v.check(input => input.ox + input.ow <= 1000 && input.oy + input.oh <= 1000, "The area must stay inside the page."),
  v.check(input => input.ow > 0 && input.oh > 0, "An area needs a width and a height."),
)

/** The connect popup asks which site drops cover the page that opened it, by the page's origin. */
export const ReviewSitesSchema = v.object({
  origin: v.pipe(v.string(), v.maxLength(300)),
})

/** Then a review token for the one the person picked, by the handle the list gave it. Guests may give a name. */
export const ReviewTokenSchema = v.object({
  origin: v.pipe(v.string(), v.maxLength(300)),
  choice: v.pipe(v.string(), v.maxLength(2048)),
  name: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60))),
})

/** Opening the review in Drop from the site, by the review token the page holds. */
export const ReviewOpenSchema = v.object({
  token: v.pipe(v.string(), v.maxLength(2048)),
})

/** A site review created in the app: the address it covers (an origin or a `*.` pattern) and its name. */
export const SiteSchema = v.object({
  url: v.pipe(v.string(), v.trim(), v.minLength(1, "Enter the site's address."), v.maxLength(300), v.check(url => siteAddress(url) !== null, SITE_ADDRESS_RULE)),
  title: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(160))),
  /** The folder to create it in, by id or link. */
  folder: v.optional(v.pipe(v.string(), v.maxLength(600))),
})

export const CommentPatchSchema = v.object({ resolved: v.boolean() })

export const CommentReplySchema = v.object({
  body: v.pipe(v.string(), v.trim(), v.minLength(1, "Write a reply."), v.maxLength(4000)),
})

export const MemberPatchSchema = v.object({ banned: v.boolean() })

export const SkillPatchSchema = v.object({ enabled: v.boolean("Say whether the skill is enabled.") })

export type CodeImageInput = v.InferOutput<typeof CodeImageSchema>
export type CommentInput = v.InferOutput<typeof CommentSchema>
export type ReviewCommentInput = v.InferOutput<typeof ReviewCommentSchema>

export const CodeImageSchema = v.strictObject({
  code: v.pipe(v.string(), v.minLength(1, "Send some code."), v.maxLength(20_000, "Code images take at most 20,000 characters.")),
  // No default here: PNG where the Drop can render it (Cloudflare), SVG elsewhere. See server/utils/code-image-store.ts.
  format: v.optional(v.picklist(["png", "svg"], "Format must be png or svg.")),
  language: v.optional(v.string()),
  scale: v.optional(v.picklist([2, 4, 6], "Scale must be 2, 4, or 6."), 4),
  theme: v.optional(v.string()),
})

export const ReportSchema = v.object({
  target: v.pipe(v.string(), v.maxLength(600), v.regex(/^\/(d|f)\//)),
  reason: v.picklist(["phishing", "malware", "spam", "copyright", "illegal/CSAM", "other"]),
  details: v.pipe(v.string(), v.trim(), v.minLength(1, "Describe the problem."), v.maxLength(4000)),
  email: v.optional(v.union([v.literal(""), v.pipe(v.string(), v.email(), v.maxLength(254))])),
})
export const ReviewSchema = v.object({ action: v.picklist(["approve", "reject"]) })
export const ReportActionSchema = v.object({ action: v.picklist(["dismiss", "quarantine", "ban"]) })
