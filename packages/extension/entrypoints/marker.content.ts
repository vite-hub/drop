import { browser } from "wxt/browser"
import { EXTENSION_MARKER } from "../../../shared/extension"

function mark() {
  document.documentElement?.setAttribute(EXTENSION_MARKER, browser.runtime.getManifest().version)
}

export default defineContentScript({
  registration: "runtime",
  matches: [],
  runAt: "document_start",
  main() {
    if (document.documentElement) mark()
    else document.addEventListener("readystatechange", mark, { once: true })
  },
})
