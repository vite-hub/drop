// Request bodies, defined once. Server routes validate with them (readValidatedBody) and forms reuse them
// (UForm :schema), so a field's rules and messages are the same on both sides.
import * as v from "valibot"
import { LIFETIMES, MAX_KEEP_REASON } from "./expiry"
import { MAX_APP_BYTES } from "./quotas"
import { ROLES } from "./roles"

/** 4 MiB: the most one file (or one app) may weigh. */
export const MAX_FILE_BYTES = MAX_APP_BYTES

export const NewDocSchema = v.object({
  filename: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  content: v.pipe(v.string(), v.maxLength(MAX_FILE_BYTES, "The file exceeds the 4 MiB limit.")),
  title: v.optional(v.string()),
  supersedes: v.optional(v.string()),
})

export const DropPatchSchema = v.object({
  visibility: v.optional(v.picklist(["private", "team", "shared"])),
  access: v.optional(v.picklist(["view", "comment", "edit"])),
  title: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(160))),
  lifetime: v.optional(v.picklist(LIFETIMES)),
  /** Required when an agent keeps a drop. */
  keepReason: v.optional(v.pipe(v.string(), v.maxLength(MAX_KEEP_REASON, `Keep the reason under ${MAX_KEEP_REASON} characters.`))),
  /** Start a fresh expiry window. */
  renew: v.optional(v.literal(true)),
  /** True moves the drop to the Trash; false restores it with a fresh window. */
  trashed: v.optional(v.boolean()),
})

export const AppSchema = v.object({
  id: v.optional(v.string()),
  name: v.optional(v.pipe(v.string(), v.maxLength(160))),
  files: v.record(v.string(), v.string()),
})

const thousandths = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000))

/** Positions are thousandths of the anchor's box; `ow`/`oh` size an area and default to 0, a point. */
export const CommentSchema = v.pipe(
  v.object({
    kind: v.picklist(["text", "image", "area"]),
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
)

export const CommentPatchSchema = v.object({ resolved: v.boolean() })

export const MemberPatchSchema = v.object({ role: v.optional(v.picklist(ROLES)), banned: v.optional(v.boolean()) })

export const SkillPatchSchema = v.object({ enabled: v.boolean("Say whether the skill is enabled.") })

export type CodeImageInput = v.InferOutput<typeof CodeImageSchema>
export type CommentInput = v.InferOutput<typeof CommentSchema>

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
