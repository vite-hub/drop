import * as v from "valibot"

const label = v.pipe(v.string(), v.minLength(1), v.maxLength(160), v.regex(/\S/))

const identifier = (max: number) =>
  v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(max),
    v.regex(new RegExp(`^(?!\\s{1,${max}}$)[^\\u0000-\\u001f\\u007f\\u2028\\u2029]{1,${max}}$`)),
  )

const AgentSessionSchema = v.object({
  harness: v.optional(v.pipe(identifier(160), v.description("The app that runs the session, e.g. T3 Code."))),
  thread: v.optional(
    v.pipe(
      identifier(320),
      v.description(
        "The thread or conversation this publish comes from: in T3 Code its t3-thread://v2/<environment>/<thread> link, elsewhere its id.",
      ),
    ),
  ),
  project: v.optional(v.pipe(identifier(160), v.description("The project's name or id in that app."))),
  worktree: v.optional(v.pipe(identifier(160), v.description("The working directory or worktree the agent works in."))),
  branch: v.optional(v.pipe(identifier(160), v.description("The git branch it works on."))),
})

const AgentMetadataSchema = v.object({
  model: v.optional(v.pipe(label, v.description("Exact model name or id from your runtime, when known."))),
  harness: v.optional(v.pipe(label, v.description("Agent harness, e.g. Codex or Claude Code, when known."))),
  reasoningLevel: v.optional(
    v.pipe(label, v.description("Reasoning level from your runtime, e.g. high. Omit when unknown.")),
  ),
  session: v.optional(
    v.pipe(
      AgentSessionSchema,
      v.description(
        "The session you publish from, as short identifiers: harness, thread, project, worktree, branch. Omit fields your runtime doesn't expose.",
      ),
    ),
  ),
})

export type AgentMetadata = v.InferOutput<typeof AgentMetadataSchema>

export const AgentInputSchema = v.union([label, AgentMetadataSchema])

export function agentMetadata(agent: v.InferOutput<typeof AgentInputSchema> | undefined): AgentMetadata | undefined {
  return v.is(label, agent) ? { model: agent } : agent
}

export function agentLabel(agent: AgentMetadata | null) {
  return [agent?.model, agent?.harness, agent?.reasoningLevel && `${agent.reasoningLevel} reasoning`]
    .filter(Boolean)
    .join(" · ")
}

export function sessionLabel(agent: AgentMetadata | null) {
  const fields = Object.entries(agent?.session ?? {}).filter(([, value]) => value)
  return fields.length ? `session ${fields.map(([key, value]) => `${key} ${JSON.stringify(value)}`).join(", ")}` : ""
}
