import * as v from "valibot"

const KEY = "drop-media-time:"
const EDGE = 3
const Spots = v.record(v.string(), v.object({ source: v.string(), at: v.number(), duration: v.number() }))
export type MediaSpots = v.InferOutput<typeof Spots>

export function readMediaSpots(drop: string): MediaSpots {
  try {
    const parsed = v.safeParse(Spots, JSON.parse(localStorage.getItem(KEY + drop) ?? "{}"))
    return parsed.success ? parsed.output : {}
  } catch {
    return {}
  }
}

export function saveMediaSpot(drop: string, index: number, source: string, at: number, duration: number) {
  if (!source || !Number.isFinite(at) || !Number.isFinite(duration) || duration <= 0) return
  const spots = readMediaSpots(drop)
  if (at <= EDGE || at >= duration - EDGE) {
    if (spots[index]?.source !== source) return
    delete spots[index]
  } else spots[index] = { source, at: Math.round(at * 10) / 10, duration: Math.round(duration * 10) / 10 }
  try {
    if (Object.keys(spots).length) localStorage.setItem(KEY + drop, JSON.stringify(spots))
    else localStorage.removeItem(KEY + drop)
  } catch {}
}

export function mediaSpotFor(spots: MediaSpots, index: number, source: string, duration: number) {
  const spot = spots[index]
  return spot?.source === source && Math.abs(spot.duration - duration) <= 1 ? spot.at : undefined
}
