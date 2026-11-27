import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { createUsageCounter } from "../../app/utils/ui-usage.ts"

const press = { kind: "markdown", mode: "browse", control: "zen", via: "click" }

test("with counting off, the browser counts and sends nothing", () => {
  const sent = []
  const usage = createUsageCounter({ on: () => false, send: (body) => sent.push(body) })
  usage.add(press)
  usage.add({ ...press, via: "shown" })
  usage.flush()
  assert.deepEqual(sent, [])
})

test("counts for the same control merge into one batch", () => {
  const sent = []
  const usage = createUsageCounter({ on: () => true, send: (body) => sent.push(body) })
  usage.add(press)
  usage.add(press)
  usage.add({ ...press, via: "shown" })
  usage.add({ ...press, mode: "comment" })
  usage.flush()
  usage.flush()
  assert.deepEqual(sent, [
    {
      event: "ui.usage",
      counts: [
        { ...press, count: 2 },
        { ...press, via: "shown", count: 1 },
        { ...press, mode: "comment", count: 1 },
      ],
    },
  ])
})

test("a batch goes out on its own when it reaches 200 counts", () => {
  const sent = []
  const usage = createUsageCounter({ on: () => true, send: (body) => sent.push(body) })
  const controls = ["home", "comments", "list", "pins", "share"]
  const vias = ["shown", "click", "key", "palette"]
  const kinds = ["markdown", "html", "site", "image", "board"]
  for (const control of controls)
    for (const via of vias)
      for (const kind of kinds) for (const mode of ["browse", "comment"]) usage.add({ kind, mode, control, via })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].counts.length, 200)
  assert.equal(usage.pending, 0)
})
