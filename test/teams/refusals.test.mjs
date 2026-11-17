import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { answerError, createClientErrorReporter } from "../../app/utils/client-errors.ts"

test("a team action Better Auth refuses keeps its status, so it isn't reported as a client failure", async () => {
  const refused = async () => ({ data: null, error: { status: 403, message: "This invitation is for someone else." } })
  Object.assign(globalThis, {
    answerError,
    useNuxtApp: () => ({ $auth: { organization: { getInvitation: refused } } }),
  })
  const { useTeams } = await import("../../app/composables/useTeams.ts")
  const error = await useTeams()
    .invitation("inv_1")
    .catch((failure) => failure)
  assert.equal(error.message, "This invitation is for someone else.")
  assert.equal(error.status, 403)
  const sent = []
  createClientErrorReporter((failure) => sent.push(failure))("notify", error, {}, { online: true, leaving: false })
  assert.deepEqual(sent, [])
})
