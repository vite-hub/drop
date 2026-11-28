import { browser } from "wxt/browser"
import { currentDrop, originPattern } from "./deployment"

export const MARKER_ID = "drop-marker"
export const MARKER_SCRIPT = "/content-scripts/marker.js"

async function sync() {
  const pattern = originPattern(await currentDrop())
  const held = await browser.permissions.contains({ origins: [pattern] })
  const registered = await browser.scripting.getRegisteredContentScripts({ ids: [MARKER_ID] })
  if (registered.length) await browser.scripting.unregisterContentScripts({ ids: [MARKER_ID] })
  if (!held) return null
  await browser.scripting.registerContentScripts([
    {
      id: MARKER_ID,
      matches: [pattern],
      js: [MARKER_SCRIPT],
      runAt: "document_start",
      persistAcrossSessions: false,
    },
  ])
  const tabs = await browser.tabs.query({ url: pattern }).catch(() => [])
  for (const tab of tabs) {
    if (tab.id === undefined) continue
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: [MARKER_SCRIPT] }).catch(() => undefined)
  }
  return pattern
}

let queue: Promise<string | null> = Promise.resolve(null)

export function syncMarker() {
  queue = queue.then(sync).catch(() => null)
  return queue
}
