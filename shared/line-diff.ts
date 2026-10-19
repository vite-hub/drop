export type DiffLine = { type: "same" | "add" | "remove"; text: string }
/** A run of unchanged lines folded away between hunks. */
export type DiffGap = { type: "gap"; lines: number }

/**
 * Lines removed and added between two texts. The common start and end are trimmed first, so an edit in a long doc
 * only compares the part around it; when even that is too big to compare (`limit` line pairs), the middle shows as
 * removed then added.
 */
export function diffLines(before: string, after: string, limit = 1_000_000): DiffLine[] {
  const a = before.split("\n"),
    b = after.split("\n")
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const x = a.slice(start, a.length - end),
    y = b.slice(start, b.length - end)
  const middle =
    x.length * y.length > limit
      ? [...x.map((text) => ({ type: "remove" as const, text })), ...y.map((text) => ({ type: "add" as const, text }))]
      : common(x, y)
  return [
    ...a.slice(0, start).map((text) => ({ type: "same" as const, text })),
    ...middle,
    ...a.slice(a.length - end).map((text) => ({ type: "same" as const, text })),
  ]
}

/** The longest common subsequence of lines, walked into removed, added, and unchanged lines. */
function common(x: string[], y: string[]): DiffLine[] {
  const width = y.length + 1
  const lengths = new Uint32Array((x.length + 1) * width)
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--)
      lengths[i * width + j] =
        x[i] === y[j]
          ? lengths[(i + 1) * width + j + 1]! + 1
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!)
  }
  const lines: DiffLine[] = []
  let i = 0,
    j = 0
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      lines.push({ type: "same", text: x[i]! })
      i++
      j++
    } else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!)
      lines.push({ type: "remove", text: x[i++]! })
    else lines.push({ type: "add", text: y[j++]! })
  }
  while (i < x.length) lines.push({ type: "remove", text: x[i++]! })
  while (j < y.length) lines.push({ type: "add", text: y[j++]! })
  return lines
}

/** The changed lines with `context` unchanged lines around each change; longer unchanged runs fold into a gap. */
export function diffHunks(lines: DiffLine[], context = 3): (DiffLine | DiffGap)[] {
  const near = new Uint8Array(lines.length)
  lines.forEach((line, index) => {
    if (line.type === "same") return
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++) near[k] = 1
  })
  const out: (DiffLine | DiffGap)[] = []
  lines.forEach((line, index) => {
    if (near[index]) return out.push(line)
    const last = out[out.length - 1]
    if (last?.type === "gap") last.lines++
    else out.push({ type: "gap", lines: 1 })
  })
  return out
}
