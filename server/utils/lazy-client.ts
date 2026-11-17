/**
 * A client whose module loads on its first call, not when the server starts. `lazyClient(load)` stands in for the
 * object `load` resolves to: `client.a.b(...args)` waits for `load()` once, then calls `a.b` on the real client with
 * `a` as `this`. The result is awaitable and, when the real one is too, async iterable, as Stripe's `list()` is.
 *
 * Every method becomes async, so only clients whose methods already return promises fit. Drop uses it for Stripe's SDK
 * (server/auth.ts), which is about 0.5 MB of Worker startup that Drops without billing never use.
 */
export function lazyClient<T extends object>(load: () => Promise<T>): T {
  let loading: Promise<T> | undefined
  const real = () => (loading ??= load())
  const at = (path: readonly PropertyKey[]): unknown =>
    new Proxy(function () {}, {
      // An awaited client is not a promise: `await client` keeps the proxy.
      get: (_, key) => (key === "then" ? undefined : at([...path, key])),
      apply: (_, __, args: unknown[]) => call(real, path, args),
    })
  const client = at([])
  // SAFETY: the proxy answers every property path of T with a callable stand-in that forwards to the real client.
  return client as T
}

function call(real: () => Promise<object>, path: readonly PropertyKey[], args: unknown[]) {
  // Boxed, so awaiting it doesn't flatten a result that is itself a promise and an iterator (Stripe's list()).
  const result: Promise<{ value: unknown }> = real().then((client) => {
    let self: unknown = client
    for (const key of path.slice(0, -1)) self = Reflect.get(Object(self), key)
    // Reflect.apply throws a TypeError when the path names no method.
    const method: (...args: unknown[]) => unknown = Reflect.get(Object(self), path.at(-1) ?? "")
    return { value: Reflect.apply(method, self, args) }
  })
  // The same shape as Stripe's own results: a promise that iterates too.
  return Object.assign(
    result.then((box) => box.value),
    {
      async *[Symbol.asyncIterator]() {
        const { value } = await result
        // SAFETY: yield* throws a TypeError when the real result isn't async iterable, as iterating it directly would.
        yield* value as AsyncIterable<unknown>
      },
    },
  )
}
