import * as v from "valibot"

const label = v.pipe(v.string(), v.minLength(1), v.maxLength(160), v.regex(/\S/))

/** An identifier for one session field: one line, so it can't start lines of its own in read_drop's text. */
// oxlint-disable-next-line no-control-regex -- the control characters are what it refuses
const identifier = v.pipe(label, v.regex(/^[^\u0000-\u001f\u007f]+$/))

/**
 * Where the publishing agent runs, so the next round's comments can reach the same session. Identifiers only, never
 * credentials or content.
 */
const AgentSessionSchema = v.object({
  harness: v.optional(v.pipe(identifier, v.description("The app that runs the session, e.g. T3 Code."))),
  thread: v.optional(
    v.pipe(identifier, v.description("The id of the thread or conversation this publish comes from.")),
  ),
  project: v.optional(v.pipe(identifier, v.description("The project's name or id in that app."))),
  worktree: v.optional(v.pipe(identifier, v.description("The working directory or worktree the agent works in."))),
  branch: v.optional(v.pipe(identifier, v.description("The git branch it works on."))),
})

export type AgentSession = v.InferOutput<typeof AgentSessionSchema>

/** Self-reported for this publish. Omit values the agent's runtime does not expose. */
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

/** What publish takes: the metadata, or only the model name as a string, which is what an agent passes first. */
export const AgentInputSchema = v.union([label, AgentMetadataSchema])

export function agentMetadata(agent: v.InferOutput<typeof AgentInputSchema> | undefined): AgentMetadata | undefined {
  return v.is(label, agent) ? { model: agent } : agent
}

export function agentLabel(agent: AgentMetadata | null) {
  return [agent?.model, agent?.harness, agent?.reasoningLevel && `${agent.reasoningLevel} reasoning`]
    .filter(Boolean)
    .join(" · ")
}

/** `session harness "T3 Code", thread "t-1", branch "feat/x"`, or nothing without a session. */
export function sessionLabel(agent: AgentMetadata | null) {
  const fields = Object.entries(agent?.session ?? {}).filter(([, value]) => value)
  return fields.length ? `session ${fields.map(([key, value]) => `${key} ${JSON.stringify(value)}`).join(", ")}` : ""
}
