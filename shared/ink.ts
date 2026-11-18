import * as v from "valibot"
import { type Ink, InkSchema } from "./schemas"

/** The most characters one comment metadata field holds in ViteHub Comments. */
export const MAX_INK_CHARS = 4000

type Point = [number, number]

// Ramer–Douglas–Peucker: the points a line keeps when nothing it drops lies more than `tolerance` pixels off it.
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3 || tolerance <= 0) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    const [ax, ay] = points[first]!,
      [bx, by] = points[last]!
    const length = Math.hypot(bx - ax, by - ay) || 1
    let farthest = -1,
      distance = tolerance
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i]!
      const off = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length
      if (off > distance) [farthest, distance] = [i, off]
    }
    if (farthest < 0) continue
    keep[farthest] = 1
    stack.push([first, farthest], [farthest, last])
  }
  return points.filter((_, i) => keep[i])
}

function encodeWith(ink: Ink, tolerance: number) {
  const strokes = ink.strokes.map((stroke) => {
    const points = simplify(
      stroke.points.map(([x, y]): Point => [Math.round(x), Math.round(y)]),
      stroke.tool === "text" ? 0 : tolerance,
    )
    // The first point, then each one as the step from the one before.
    const steps = points.flatMap(([x, y], i) => (i ? [x - points[i - 1]![0], y - points[i - 1]![1]] : [x, y]))
    return [stroke.tool, stroke.color, stroke.width, stroke.straight ? 1 : 0, stroke.text ?? "", steps]
  })
  return JSON.stringify([Math.round(ink.w), Math.round(ink.h), strokes])
}

/**
 * The Marker's strokes as one metadata string: whole pixels, each point as the step from the one before. A drawing too
 * detailed for MAX_INK_CHARS loses the points that bend its lines least, a pixel at a time, up to 8; null when it
 * still doesn't fit, and the comment keeps its box and its picture only.
 */
export function encodeInk(ink: Ink): string | null {
  for (const tolerance of [0, 0.5, 1, 2, 4, 8]) {
    const text = encodeWith(ink, tolerance)
    if (text.length <= MAX_INK_CHARS) return text
  }
  return null
}

const Encoded = v.tuple([
  v.number(),
  v.number(),
  v.array(v.tuple([v.string(), v.string(), v.number(), v.number(), v.string(), v.array(v.number())])),
])

/** The strokes encodeInk saved, or null when there are none or they don't read. */
export function decodeInk(text: string | null | undefined): Ink | null {
  if (!text) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = v.safeParse(Encoded, raw)
  if (!parsed.success) return null
  const [w, h, list] = parsed.output
  const strokes = list.map(([tool, color, width, straight, label, steps]) => {
    const points: Point[] = []
    for (let i = 0; i + 1 < steps.length; i += 2) {
      const last = points.at(-1) ?? [0, 0]
      points.push([last[0] + steps[i]!, last[1] + steps[i + 1]!])
    }
    return { tool, color, width, points, ...(straight ? { straight: true } : {}), ...(label ? { text: label } : {}) }
  })
  const ink = v.safeParse(InkSchema, { w, h, strokes })
  return ink.success ? ink.output : null
}
