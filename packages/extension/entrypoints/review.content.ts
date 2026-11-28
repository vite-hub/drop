import { browser } from "wxt/browser"
import { transport } from "../lib/transport"

const TAG = "drop-review"

export default defineContentScript({
  registration: "runtime",
  matches: [],
  main() {
    if (window.top !== window) return
    if (document.querySelector(TAG)) return

    const host = document.createElement(TAG)
    const root = host.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent = `
      :host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; }
      :host([hidden]) { display: none; }
      button { font: 500 13px/1 system-ui, sans-serif; padding: 8px 12px; border-radius: 999px; border: 1px solid #e5e5e5;
        background: #fff; color: #0a0a0a; cursor: pointer; }
    `
    const close = document.createElement("button")
    close.type = "button"
    close.textContent = "Close Drop"
    close.addEventListener("click", () => {
      host.remove()
      void transport.closed()
    })
    root.append(style, close)
    document.documentElement.append(host)

    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (shown: boolean) => void) => {
      const toggle =
        typeof message === "object" && message !== null && "type" in message && message.type === "pill.toggle"
      if (!toggle || !host.isConnected) return undefined
      host.hidden = !host.hidden
      sendResponse(!host.hidden)
      return undefined
    })
  },
})
