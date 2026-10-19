import { readFile, writeFile } from "node:fs/promises"

// Vercel Hobby accepts daily cron jobs. Keep other hosts' hourly schedule.
const file = new URL("../.vercel/output/config.json", import.meta.url)
const config = JSON.parse(await readFile(file, "utf8"))
const cleanup = config.crons?.find((cron) => cron.path === "/api/vitehub/schedules/vercel/cleanup")
if (!cleanup) throw new Error("Vercel cleanup cron is missing")
cleanup.schedule = "0 0 * * *"
await writeFile(file, JSON.stringify(config, null, 2))
