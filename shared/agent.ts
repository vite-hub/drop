import * as v from "valibot"

const label = v.pipe(v.string(), v.minLength(1), v.maxLength(160), v.regex(/\S/))

/** Self-reported for this publish. Omit values the agent's runtime does not expose. */
export const AgentMetadataSchema = v.object({
  model: v.optional(v.pipe(label, v.description("Exact model name or id from your runtime, when known."))),
  harness: v.optional(v.pipe(label, v.description("Agent harness, e.g. Codex or Claude Code, when known."))),
  reasoningLevel: v.optional(
    v.pipe(label, v.description("Reasoning level from your runtime, e.g. high. Omit when unknown.")),
  ),
})

export type AgentMetadata = v.InferOutput<typeof AgentMetadataSchema>

/** What publish takes: the metadata, or only the model name as a string, which is what an agent passes first. */
export const AgentInputSchema = v.union([label, AgentMetadataSchema])

export function agentMetadata(agent: v.InferOutput<typeof AgentInputSchema> | undefined): AgentMetadata | undefined {
  return typeof agent === "string" ? { model: agent } : agent
}

export function agentLabel(agent: AgentMetadata | null) {
  return [agent?.model, agent?.harness, agent?.reasoningLevel && `${agent.reasoningLevel} reasoning`]
    .filter(Boolean)
    .join(" · ")
}
