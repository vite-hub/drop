import { defineHandler, setResponseHeader } from "h3"
import { kv } from "vite-hub/kv"

export default defineHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "public, max-age=300")

  const keys = await kv.keys("savings")
  const savings = (await Promise.all(keys.map(key => kv.get<{finalSize: number, originalSize: number, savedBytes: number}>(key))))
    .filter(value => value !== null)
  const totals = savings.reduce((total, value) => ({
    finalBytes: total.finalBytes + value.finalSize,
    originalBytes: total.originalBytes + value.originalSize,
    savedBytes: total.savedBytes + value.savedBytes,
  }), { finalBytes: 0, originalBytes: 0, savedBytes: 0 })

  return {
    ...totals,
    savingsPercent: totals.originalBytes ? Math.round(totals.savedBytes / totals.originalBytes * 100) : 0,
    uploads: savings.length,
  }
})
