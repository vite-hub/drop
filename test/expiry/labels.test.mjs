import assert from "node:assert/strict"
import { test } from "vite-plus/test"
const { DAY_MS, expiryLabel, lifetimeHint, lifetimeLabel, LIFETIMES } = await import("../../shared/expiry.ts")

test("people see each lifetime as how long it lasts, never its API value", () => {
  assert.deepEqual(
    LIFETIMES.map((lifetime) => lifetimeLabel(lifetime, 30)),
    ["14 days", "30 days", "Never delete"],
  )
  assert.deepEqual(
    LIFETIMES.map((lifetime) => lifetimeHint(lifetime, 30)),
    [
      "Goes to the Trash if nobody opens it for 14 days.",
      "Goes to the Trash if nobody opens it for 30 days.",
      "Stays until someone deletes it.",
    ],
  )
})

test("the labels follow an admin's window", () => {
  assert.deepEqual(
    LIFETIMES.map((lifetime) => lifetimeLabel(lifetime, 60)),
    ["14 days", "60 days", "Never delete"],
  )
  assert.equal(lifetimeLabel("temporary", 7), "7 days")
  assert.equal(lifetimeHint("review", 1), "Goes to the Trash if nobody opens it for 1 day.")
})

test("the status line says when the drop goes to the Trash, and when the Trash deletes it", () => {
  const now = Date.UTC(2026, 10, 5)
  assert.equal(expiryLabel({ expiresAt: now + 6 * DAY_MS, trashedAt: null }, now), "Goes to the Trash in 6 days")
  assert.equal(expiryLabel({ expiresAt: now + DAY_MS, trashedAt: null }, now), "Goes to the Trash in 1 day")
  assert.equal(expiryLabel({ expiresAt: null, trashedAt: null }, now), "Never deleted")
  assert.equal(
    expiryLabel({ expiresAt: null, trashedAt: now - 13 * DAY_MS }, now),
    "In the Trash. Deleted for good in 2 days",
  )
})
