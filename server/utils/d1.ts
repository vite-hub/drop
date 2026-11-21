const D1_MAX_BINDINGS = 100

export function d1Chunks<T>(items: readonly T[], { perItem = 1, others = 10 } = {}): T[][] {
  const size = Math.max(1, Math.floor((D1_MAX_BINDINGS - others) / perItem))
  const chunks: T[][] = []
  for (let offset = 0; offset < items.length; offset += size) chunks.push(items.slice(offset, offset + size))
  return chunks
}
