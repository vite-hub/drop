/** D1 binds at most 100 values in one statement. */
const D1_MAX_BINDINGS = 100

/**
 * `items` in runs that each fit one D1 statement: `perItem` bound values for each item, beside the `others` the
 * statement binds besides (10 by default, enough for a few conditions).
 */
export function d1Chunks<T>(items: readonly T[], { perItem = 1, others = 10 } = {}): T[][] {
  const size = Math.max(1, Math.floor((D1_MAX_BINDINGS - others) / perItem))
  const chunks: T[][] = []
  for (let offset = 0; offset < items.length; offset += size) chunks.push(items.slice(offset, offset + size))
  return chunks
}
