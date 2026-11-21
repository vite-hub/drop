/**
 * The heading a drop list files a time under: Today, Yesterday, This week (the six days before today), or its month.
 * Days are calendar days in `timeZone`, the reader's own when it's undefined and UTC before hydration, so a day that
 * gains or loses an hour for daylight saving still starts at midnight.
 */
export function dayGroup(at: number, now: number, timeZone?: "UTC") {
  const utc = timeZone === "UTC"
  const daysAgo = (days: number) => {
    const day = new Date(now)
    if (utc) {
      day.setUTCHours(0, 0, 0, 0)
      day.setUTCDate(day.getUTCDate() - days)
    } else {
      day.setHours(0, 0, 0, 0)
      day.setDate(day.getDate() - days)
    }
    return day.getTime()
  }
  if (at >= daysAgo(0)) return "Today"
  if (at >= daysAgo(1)) return "Yesterday"
  if (at >= daysAgo(6)) return "This week"
  return new Date(at).toLocaleDateString("en", { timeZone, month: "long", year: "numeric" })
}
