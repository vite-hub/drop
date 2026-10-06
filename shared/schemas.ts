// Request bodies, defined once. Server routes validate with them (readValidatedBody) and forms reuse them
// (UForm :schema), so a field's rules and messages are the same on both sides.
import * as v from "valibot"
import { DEFAULT_ROLE, ROLES } from "./roles"

/** 4 MiB: the most one file (or one app) may weigh. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024

export const NewDocSchema = v.object({
  filename: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  content: v.pipe(v.string(), v.maxLength(MAX_FILE_BYTES)),
  title: v.optional(v.string()),
  supersedes: v.optional(v.string()),
})

export const DropPatchSchema = v.object({
  visibility: v.optional(v.picklist(["private", "shared"])),
  access: v.optional(v.picklist(["view", "comment", "edit"])),
  title: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(160))),
})

export const VersionSchema = v.union([
  v.object({ content: v.pipe(v.string(), v.maxLength(MAX_FILE_BYTES)) }),
  v.object({ files: v.record(v.string(), v.string()) }),
])

export const AppSchema = v.object({
  id: v.optional(v.string()),
  name: v.optional(v.pipe(v.string(), v.maxLength(160))),
  files: v.record(v.string(), v.string()),
})

export const CommentSchema = v.object({
  kind: v.picklist(["text", "image"]),
  selector: v.pipe(v.string(), v.maxLength(2000)),
  ox: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000)),
  oy: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000)),
  quote: v.optional(v.pipe(v.string(), v.maxLength(2000))),
  label: v.optional(v.pipe(v.string(), v.maxLength(200))),
  page: v.optional(v.pipe(v.string(), v.maxLength(300))),
  body: v.pipe(v.string(), v.trim(), v.minLength(1, "Write a comment."), v.maxLength(4000)),
})

export const CommentPatchSchema = v.object({ resolved: v.boolean() })

export const InviteSchema = v.object({
  email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email("Enter an email address.")),
  role: v.optional(v.picklist(ROLES), DEFAULT_ROLE),
})

export const MemberPatchSchema = v.object({ role: v.optional(v.picklist(ROLES)), banned: v.optional(v.boolean()) })

export const ApiKeySchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, "Name the key, ideally after the agent."), v.maxLength(60, "Keep it under 60 characters.")),
})

export const FilePathSchema = v.object({
  path: v.pipe(v.string(), v.trim(), v.minLength(1, "Enter a path."), v.maxLength(300), v.regex(/^(?!\/)(?!.*\.\.)/, "Use a relative path without `..`.")),
})

export type InviteInput = v.InferOutput<typeof InviteSchema>
export type ApiKeyInput = v.InferOutput<typeof ApiKeySchema>
export type CommentInput = v.InferOutput<typeof CommentSchema>

export const CodeImageSchema = v.strictObject({
  code: v.pipe(v.string(), v.minLength(1, "Send some code."), v.maxLength(20_000, "Code images take at most 20,000 characters.")),
  format: v.optional(v.picklist(["png", "svg"], "Format must be png or svg."), "png"),
  language: v.optional(v.string()),
  scale: v.optional(v.picklist([2, 4, 6], "Scale must be 2, 4, or 6."), 4),
  theme: v.optional(v.string()),
})
