import assert from "node:assert/strict"
import { test, vi } from "vite-plus/test"
import { effectScope, nextTick, ref, toValue, watch } from "vue"
import { useUiUsage } from "../../app/composables/useUiUsage.ts"
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

test("mode changes retain visible controls; reappearances and new drops count again", async () => {
  const sent = []
  const document = { visibilityState: "hidden" }
  const commenting = ref(false)
  const hidden = ref(false)
  const view = ref("first")
  let scan
  let flush
  const scope = effectScope()
  const isActive = ref(false)
  function frame() {
    assert.equal(isActive.value, true)
    isActive.value = false
    scan()
  }
  const element = (control) => ({ getAttribute: () => control, closest: () => null })
  const pill = { querySelectorAll: () => [element("more"), ...(commenting.value ? [element("list")] : [])] }
  const globals = {
    window: {},
    document,
    toValue,
    watch,
    useState: () => ref(true),
    createUsageCounter,
    sendClientEvent: (body) => sent.push(...body.counts),
    useTimeoutFn: () => ({ isPending: ref(false), start() {}, stop() {} }),
    useRafFn: (callback) => ({
      isActive,
      resume() {
        scan = callback
        isActive.value = true
      },
    }),
    useEventListener: (target, name, callback) => {
      if (target === document && name === "visibilitychange") flush = callback
    },
    useMutationObserver() {},
    useResizeObserver() {},
    onBeforeUnmount() {},
  }
  for (const [name, value] of Object.entries(globals)) vi.stubGlobal(name, value)
  try {
    const usage = scope.run(() =>
      useUiUsage({
        pill,
        kind: () => "markdown",
        commenting: () => commenting.value,
        view: () => view.value,
        hidden: () => hidden.value,
      }),
    )
    frame()
    for (const mode of [true, false, true]) {
      commenting.value = mode
      await nextTick()
      frame()
    }
    usage.key("e", () => false)
    usage.key("h", () => undefined)
    usage.key("w", () => true)
    flush()
    assert.deepEqual(
      sent.map(({ mode, control, via, count }) => [mode, control, via, count]),
      [
        ["browse", "more", "shown", 1],
        ["comment", "list", "shown", 2],
        ["comment", "width", "key", 1],
      ],
    )

    sent.length = 0
    hidden.value = true
    await nextTick()
    frame()
    hidden.value = false
    await nextTick()
    frame()
    view.value = "second"
    await nextTick()
    frame()
    flush()
    assert.deepEqual(
      sent.map(({ mode, control, via, count }) => [mode, control, via, count]),
      [
        ["comment", "more", "shown", 2],
        ["comment", "list", "shown", 2],
      ],
    )
  } finally {
    scope.stop()
    vi.unstubAllGlobals()
  }
})
