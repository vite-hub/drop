export function lazyClient<T extends object>(load: () => Promise<T>): T {
  let loading: Promise<T> | undefined
  const real = () => (loading ??= load())
  const at = (path: readonly PropertyKey[]): unknown =>
    new Proxy(function () {}, {
      get: (_, key) => (key === "then" ? undefined : at([...path, key])),
      apply: (_, __, args: unknown[]) => call(real, path, args),
    })
  const client = at([])
  // SAFETY: the proxy answers every property path of T with a callable stand-in that forwards to the real client.
  return client as T
}

function call(real: () => Promise<object>, path: readonly PropertyKey[], args: unknown[]) {
  const result: Promise<{ value: unknown }> = real().then((client) => {
    let self: unknown = client
    for (const key of path.slice(0, -1)) self = Reflect.get(Object(self), key)
    const method: (...args: unknown[]) => unknown = Reflect.get(Object(self), path.at(-1) ?? "")
    return { value: Reflect.apply(method, self, args) }
  })
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
