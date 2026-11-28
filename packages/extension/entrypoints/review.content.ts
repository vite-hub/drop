import { connectRealtimeRoom } from "@vite-hub/realtime/client/browser.js"
import mountReview from "virtual:drop-review"
import { browser } from "wxt/browser"
import { REVIEW_HOST_VERSION, type ReviewHost, type ReviewHostSend } from "../../../shared/review-host"
import { send } from "../lib/messages"

const TAG = "drop-review"
const YIELD = "drop-review:yield"

interface Pill {
  host?: Element
  mounting: boolean
}

declare global {
  var __dropReviewHost: ReviewHost | undefined
  var __dropExtension: Pill | undefined
}

const ownScript = (drop: string) =>
  Array.from(document.scripts).some((script) => {
    if (!script.src) return false
    const url = new URL(script.src, location.href)
    return url.origin === drop && url.pathname.endsWith("/review.js")
  })

// SAFETY: the background answers each review.host request with ReviewHostReply for its type (lib/host.ts).
const hostSend = ((request) => send("review.host", { request })) as ReviewHostSend

async function mount(pill: Pill) {
  if (pill.host?.isConnected || pill.mounting) return
  pill.mounting = true
  try {
    const start = await send("notes.targets", {})
    if ("blocked" in start) return
    if (document.querySelector(TAG)) {
      if (!ownScript(start.drop)) return
      window.dispatchEvent(new CustomEvent(YIELD))
    }
    globalThis.__dropReviewHost = {
      version: REVIEW_HOST_VERSION,
      drop: start.drop,
      targets: start.targets,
      ...(start.target ? { target: start.target } : {}),
      send: hostSend,
      realtime: { connectRealtimeRoom },
    }
    const before = new Set(document.querySelectorAll(TAG))
    mountReview()
    pill.host = Array.from(document.querySelectorAll(TAG)).find((element) => !before.has(element))
  } finally {
    pill.mounting = false
  }
}

function close(pill: Pill) {
  if (!pill.host?.isConnected) return
  window.dispatchEvent(new CustomEvent(YIELD))
  pill.host = undefined
  void send("pill.closed", {}).catch(() => undefined)
}

export default defineContentScript({
  registration: "runtime",
  matches: [],
  main() {
    if (window.top !== window) return
    if (globalThis.__dropExtension) {
      void mount(globalThis.__dropExtension)
      return
    }
    const pill: Pill = { mounting: false }
    globalThis.__dropExtension = pill
    browser.runtime.onMessage.addListener((message: unknown, _sender, reply: (shown: boolean) => void) => {
      if (typeof message !== "object" || message === null || !("type" in message) || message.type !== "pill.toggle")
        return undefined
      if (pill.host?.isConnected) {
        close(pill)
        reply(false)
        return undefined
      }
      void mount(pill).then(() => reply(Boolean(pill.host?.isConnected)))
      return true
    })
    void mount(pill)
  },
})
