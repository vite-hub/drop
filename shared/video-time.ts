const two = (value: number) => String(value).padStart(2, "0")

/** A second of a video as a player shows it: 0:07, 1:02:07. */
export function clock(time: number): string {
  const seconds = Math.max(0, Math.floor(time))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  return `${hours ? `${hours}:${two(minutes)}` : minutes}:${two(seconds % 60)}`
}

/**
 * The second a video's link starts at, from its `?t=`: seconds (`75`, `75.5`, `75s`), a clock (`1:15`, `1:02:07`), or
 * YouTube's `1m15s`. Anything else starts at the beginning.
 */
export function startTime(value: string | undefined): number {
  const text = value?.trim().toLowerCase() ?? ""
  if (/^\d+(\.\d+)?s?$/.test(text)) return Number.parseFloat(text)
  if (/^\d+(:\d{1,2}){1,2}$/.test(text)) return text.split(":").reduce((total, part) => total * 60 + Number(part), 0)
  const units = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (units && text) return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0)
  return 0
}
