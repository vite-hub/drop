import * as v from "valibot"
import { CARD_REASONS } from "./content-unavailable"
import { LIFETIMES, MAX_KEEP_REASON } from "./expiry"
import { MAX_SLUG, slugify } from "./links"
import { MIB } from "./quotas"
import { MAX_REVIEW_PAGE, SITE_ADDRESS_RULE, siteAddress } from "./review"
import { SHARES } from "./share"

export const MAX_FILE_BYTES = 4 * MIB

export const MAX_COMMENT_IMAGES = 4
export const COMMENT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const

export const NewDocSchema = v.object({
  filename: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  content: v.pipe(v.string(), v.maxLength(MAX_FILE_BYTES, "The file exceeds the 4 MiB limit.")),
  title: v.optional(v.string()),
  supersedes: v.optional(v.string()),
})

export const DropPatchSchema = v.object({
  share: v.optional(v.picklist(SHARES)),
  description: v.optional(v.pipe(v.string(), v.maxLength(2000, "Keep the description under 2,000 characters."))),
  url: v.optional(v.pipe(v.string(), v.maxLength(2000))),
  title: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(160))),
  slug: v.optional(
    v.pipe(
      v.string(),
      v.maxLength(MAX_SLUG),
      v.check((value) => slugify(value) !== "", "Use letters or numbers in the slug."),
    ),
  ),
  lifetime: v.optional(v.picklist(LIFETIMES)),
  keepReason: v.optional(
    v.pipe(v.string(), v.maxLength(MAX_KEEP_REASON, `Keep the reason under ${MAX_KEEP_REASON} characters.`)),
  ),
  renew: v.optional(v.literal(true)),
  trashed: v.optional(v.boolean()),
  folder: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(600)))),
})

export const FolderSchema = v.object({
  title: v.pipe(v.string(), v.trim(), v.minLength(1, "Name the folder."), v.maxLength(160)),
  description: v.optional(
    v.pipe(v.string(), v.trim(), v.maxLength(2000, "Keep the description under 2,000 characters.")),
  ),
  team: v.optional(v.boolean()),
  teamId: v.optional(v.pipe(v.string(), v.maxLength(100))),
  folder: v.optional(v.pipe(v.string(), v.maxLength(600))),
})

export const AppSchema = v.object({
  id: v.optional(v.string()),
  name: v.optional(v.pipe(v.string(), v.maxLength(160))),
  slug: v.optional(v.pipe(v.string(), v.maxLength(MAX_SLUG))),
  files: v.record(v.string(), v.string()),
  removes: v.optional(v.pipe(v.array(v.string()), v.maxLength(200))),
})

const MentionsSchema = v.optional(v.pipe(v.array(v.pipe(v.string(), v.maxLength(200))), v.maxLength(20)), [])

const thousandths = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000))

export const MAX_INK_STROKES = 60
export const MAX_INK_POINTS = 6000
const inkCoordinate = v.pipe(v.number(), v.minValue(-100_000), v.maxValue(100_000))

export const InkSchema = v.pipe(
  v.object({
    w: v.pipe(v.number(), v.minValue(1), v.maxValue(100_000)),
    h: v.pipe(v.number(), v.minValue(1), v.maxValue(100_000)),
    strokes: v.pipe(
      v.array(
        v.object({
          tool: v.picklist(["marker", "pen", "arrow", "text"]),
          color: v.pipe(v.string(), v.regex(/^#[0-9a-f]{6}$/i)),
          width: v.pipe(v.number(), v.minValue(1), v.maxValue(64)),
          points: v.pipe(v.array(v.tuple([inkCoordinate, inkCoordinate])), v.minLength(1), v.maxLength(MAX_INK_POINTS)),
          straight: v.optional(v.boolean()),
          text: v.optional(v.pipe(v.string(), v.maxLength(200))),
        }),
      ),
      v.minLength(1),
      v.maxLength(MAX_INK_STROKES),
    ),
  }),
  v.check(
    (ink) => ink.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) <= MAX_INK_POINTS,
    `The Marker's strokes hold at most ${MAX_INK_POINTS} points.`,
  ),
)
export type Ink = v.InferOutput<typeof InkSchema>

const RequestIdSchema = v.optional(v.pipe(v.string(), v.uuid()))
const SenderSchema = v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(100)))

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
    suggestion: v.optional(v.pipe(v.string(), v.maxLength(2000))),
    at: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(86_400))),
    pdfPage: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100_000))),
    ink: v.optional(InkSchema),
    body: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(4000)), ""),
    mentions: MentionsSchema,
    requestId: RequestIdSchema,
    as: SenderSchema,
  }),
  v.check(
    (input) => input.ox + input.ow <= 1000 && input.oy + input.oh <= 1000,
    "The area must stay inside its anchor.",
  ),
  v.check(
    (input) => input.kind !== "area" || input.ow > 0 === input.oh > 0,
    "An area needs both a width and a height.",
  ),
  v.check(
    (input) =>
      input.kind !== "page" || (!input.selector && !input.ox && !input.oy && !input.ow && !input.oh && !input.quote),
    "A comment on the whole page points at nothing in it.",
  ),
  v.check(
    (input) => input.suggestion === undefined || (input.kind === "text" && Boolean(input.quote)),
    "A suggestion replaces selected text.",
  ),
  v.check(
    (input) => input.ink === undefined || (input.kind === "area" && input.ow > 0),
    "The Marker's strokes go on an area.",
  ),
  v.check((input) => input.at === undefined || input.kind === "image", "A video's frame takes a spot or an area."),
  v.check((input) => input.pdfPage === undefined || input.kind === "image", "A PDF's page takes a spot or an area."),
  v.check(
    (input) => input.at === undefined || input.pdfPage === undefined,
    "A comment is on a frame or a page, not both.",
  ),
)

export const ReviewCommentSchema = v.pipe(
  v.object({
    body: v.pipe(v.string(), v.trim(), v.minLength(1, "Write a comment."), v.maxLength(4000)),
    requestId: RequestIdSchema,
    as: SenderSchema,
    page: v.pipe(v.string(), v.startsWith("/"), v.maxLength(MAX_REVIEW_PAGE)),
    selector: v.optional(v.pipe(v.string(), v.maxLength(2000)), ""),
    label: v.optional(v.pipe(v.string(), v.maxLength(200))),
    ox: thousandths,
    oy: thousandths,
    ow: thousandths,
    oh: thousandths,
    spot: v.optional(v.object({ x: thousandths, y: thousandths })),
    viewport: v.object({
      width: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20_000)),
      height: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20_000)),
    }),
  }),
  v.check((input) => input.ox + input.ow <= 1000 && input.oy + input.oh <= 1000, "The area must stay inside the page."),
  v.check((input) => input.ow > 0 && input.oh > 0, "An area needs a width and a height."),
)

export const ReviewSitesSchema = v.object({
  origin: v.pipe(v.string(), v.maxLength(300)),
})

export const ReviewTokenSchema = v.object({
  origin: v.pipe(v.string(), v.maxLength(300)),
  choice: v.pipe(v.string(), v.maxLength(2048)),
  name: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60))),
})

export const ReviewOpenSchema = v.union([
  v.object({ token: v.pipe(v.string(), v.maxLength(2048)) }),
  v.object({ doc: v.pipe(v.string(), v.maxLength(2048)) }),
])

export const SiteSchema = v.object({
  url: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1, "Enter the site's address."),
    v.maxLength(300),
    v.check((url) => siteAddress(url) !== null, SITE_ADDRESS_RULE),
  ),
  title: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(160))),
  folder: v.optional(v.pipe(v.string(), v.maxLength(600))),
})

export const CommentPatchSchema = v.object({ resolved: v.boolean() })

export const CommentReplySchema = v.object({
  body: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(4000)), ""),
  mentions: MentionsSchema,
  requestId: RequestIdSchema,
  as: SenderSchema,
})

export const CommentEditSchema = v.object({
  body: v.pipe(v.string(), v.trim(), v.minLength(1, "Write a comment."), v.maxLength(4000)),
  mentions: MentionsSchema,
})

export const SkillPatchSchema = v.object({ enabled: v.boolean("Say whether the skill is enabled.") })

export type CodeImageInput = v.InferOutput<typeof CodeImageSchema>
export type CommentInput = v.InferOutput<typeof CommentSchema>
export type ReviewCommentInput = v.InferOutput<typeof ReviewCommentSchema>

export const CodeImageSchema = v.strictObject({
  code: v.pipe(
    v.string(),
    v.minLength(1, "Send some code."),
    v.maxLength(20_000, "Code images take at most 20,000 characters."),
  ),
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

export const PeeksQuerySchema = v.object({ ids: v.pipe(v.string(), v.maxLength(90 * 24)) })

export const DropsQuerySchema = v.object({
  q: v.optional(v.string()),
  kind: v.optional(v.string()),
  folder: v.optional(v.pipe(v.string(), v.maxLength(600))),
  trash: v.optional(v.string()),
  shared: v.optional(v.string()),
  folders: v.optional(v.string()),
  pinned: v.optional(v.string()),
  limit: v.optional(v.pipe(v.string(), v.regex(/^[1-9]\d{0,2}$/))),
})

export const DropTreeQuerySchema = v.object({ open: v.optional(v.pipe(v.string(), v.maxLength(100))) })

export const SearchQuerySchema = v.object({ q: v.optional(v.string()), kind: v.optional(v.string()) })
export const LinkQuerySchema = v.object({ v: v.optional(v.string()) })
export const ReviewCommentsQuerySchema = v.object({ page: v.optional(v.string()) })

export const RuntimeErrorSchema = v.object({
  kind: v.picklist(["error", "rejection", "console", "load"]),
  message: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
  source: v.optional(v.pipe(v.string(), v.maxLength(300))),
  page: v.optional(v.pipe(v.string(), v.maxLength(300))),
})

export const SIGN_IN_MODES = ["proxy", "github"] as const
const failure = {
  code: v.optional(v.pipe(v.string(), v.regex(/^[A-Za-z][\w.]{0,59}$/))),
  status: v.optional(v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(599))),
}
export const ClientEventSchema = v.variant("event", [
  v.strictObject({ event: v.literal("card.shown"), reason: v.picklist(CARD_REASONS) }),
  v.strictObject({
    event: v.literal("signin.clicked"),
    mode: v.picklist(SIGN_IN_MODES),
    via: v.picklist(["button", "card"]),
  }),
  v.strictObject({
    event: v.picklist(["signin.switch_account", "consent.allowed", "consent.denied", "consent.invalid_link"]),
  }),
  v.strictObject({ event: v.picklist(["signin.failed", "consent.failed"]), ...failure }),
])
