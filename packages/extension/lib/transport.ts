import { send, type ReviewFetch } from "./messages"

export const transport = {
  session: (options: { target?: string; create?: boolean } = {}) => send("review.session", options),
  fetch: (request: ReviewFetch) => send("review.fetch", request),
  presence: (target?: string) => send("review.presence", target ? { target } : {}),
  index: () => send("notes.index", {}),
  targets: () => send("notes.targets", {}),
  closed: () => send("pill.closed", {}),
}
