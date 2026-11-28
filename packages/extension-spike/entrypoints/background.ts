// Spike background: Chrome MV3 service worker, Firefox MV3 event page.
// The harness drives it through runtime messages sent from the options page.

type Log = { at: number; kind: string; detail?: unknown }

// Serialized, so concurrent handlers don't overwrite each other's read-modify-write.
let queue = Promise.resolve()
function log(kind: string, detail?: unknown) {
  queue = queue.then(async () => {
    const { events = [] } = (await browser.storage.local.get("events")) as { events?: Log[] }
    events.push({ at: Date.now(), kind, detail })
    await browser.storage.local.set({ events })
  })
  return queue
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function inject(tabId: number, via: string) {
  try {
    const [result] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => location.href,
    })
    await log("inject", { via, ok: true, url: result?.result })
    return { ok: true, url: result?.result }
  } catch (error) {
    await log("inject", { via, ok: false, error: errorText(error) })
    return { ok: false, error: errorText(error) }
  }
}

async function mountOverlay(tabId: number) {
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: ["/content-scripts/overlay.js"] })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
}

async function capture(windowId?: number) {
  try {
    const dataUrl = await browser.tabs.captureVisibleTab(windowId ?? browser.windows.WINDOW_ID_CURRENT, {
      format: "png",
    })
    return { ok: true, dataUrl }
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
}

// Opening the popup or pressing the command is the user action that grants activeTab, so it runs every
// per-tab check at once.
async function popupRun(tabId: number, windowId: number, via = "popup") {
  const probe = await inject(tabId, via)
  const overlay = await mountOverlay(tabId)
  const shot = await capture(windowId)
  await log("popup-run", { via, probe, overlay, capture: shot.ok ? shot.dataUrl : shot })
  return { probe, overlay, capture: shot.ok ? "ok" : shot }
}

let socket: WebSocket | undefined

function openSocket(url: string) {
  socket = new WebSocket(url)
  socket.addEventListener("open", () => void log("ws-open", { url }))
  socket.addEventListener("error", () => void log("ws-error", { url }))
  socket.addEventListener("close", (event) => void log("ws-close", { code: event.code }))
  socket.addEventListener("message", () => {
    // Echo nothing back: a reply would count as extension activity.
  })
}

export default defineBackground(() => {
  void log("background-start")

  browser.runtime.onInstalled.addListener((details) => {
    void log("installed", { reason: details.reason })
    browser.contextMenus.create({ id: "drop-review", title: "Review with Drop", contexts: ["page"] })
    // Row 6: open one socket at install and then stay idle, so no harness or DevTools session is attached
    // to the worker. The spike's ws server (harness/server.mjs) logs when it closes.
    openSocket(`ws://127.0.0.1:47811/?from=onInstalled&browser=${import.meta.env.BROWSER}`)
  })

  browser.contextMenus.onClicked.addListener((_info, tab) => {
    if (tab?.id) void inject(tab.id, "contextMenu")
  })

  browser.commands.onCommand.addListener((command, tab) => {
    void log("command", { command, tabId: tab?.id })
    if (tab?.id) void popupRun(tab.id, tab.windowId, "command")
  })

  browser.action.onClicked.addListener((tab) => {
    void log("action", { tabId: tab.id })
    if (tab.id) {
      void inject(tab.id, "action")
      void capture(tab.windowId).then((shot) => log("action-capture", shot.ok ? shot.dataUrl : shot))
    }
  })

  // Row 2b: with a host permission for the origin, re-inject on every load without a user action.
  browser.tabs.onUpdated.addListener(async (tabId, change, tab) => {
    if (change.status !== "complete") return
    await log("onUpdated", { tabId, status: change.status, url: tab.url ?? null })
    // Try the injection on every http load (or when tab.url is hidden) and log what the browser says, rather than
    // asking permissions.contains first: Firefox answers it differently for patterns with and without a port.
    if (!tab.url) await inject(tabId, "onUpdated-url-hidden")
    else if (tab.url.startsWith("http")) await inject(tabId, "onUpdated")
  })

  browser.runtime.onMessage.addListener((message: { type: string; [key: string]: any }) => {
    switch (message.type) {
      case "inject":
        return inject(message.tabId, message.via ?? "message")
      case "popup-run":
        return popupRun(message.tabId, message.windowId)
      case "overlay":
        return mountOverlay(message.tabId)
      case "capture":
        return capture(message.windowId)
      case "ws-start":
        openSocket(message.url)
        return Promise.resolve({ ok: true })
      case "auth":
        return browser.identity
          .launchWebAuthFlow({ url: message.url, interactive: message.interactive ?? true })
          .then(
            (url) => ({ ok: true, url }),
            (error) => ({ ok: false, error: errorText(error) }),
          )
      case "redirect-url":
        return Promise.resolve({ url: browser.identity.getRedirectURL() })
    }
    return undefined
  })
})
