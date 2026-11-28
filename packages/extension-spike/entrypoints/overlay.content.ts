// Row 4: a closed shadow root with a <style> and a constructable stylesheet, on a strict-CSP page.
// Injected on demand with scripting.executeScript({ files }), so it needs no host permission in the manifest.
export default defineContentScript({
  registration: "runtime",
  matches: [],
  main() {
    const host = document.createElement("drop-spike-overlay")
    document.documentElement.append(host)
    const root = host.attachShadow({ mode: "closed" })

    const style = document.createElement("style")
    style.textContent = ".by-style { color: rgb(255, 0, 0); padding: 7px; }"
    root.append(style)

    const byStyle = document.createElement("div")
    byStyle.className = "by-style"
    byStyle.textContent = "styled by <style>"
    const bySheet = document.createElement("div")
    bySheet.className = "by-sheet"
    bySheet.textContent = "styled by adoptedStyleSheets"
    root.append(byStyle, bySheet)

    const result: Record<string, unknown> = {
      shadowHiddenFromPage: host.shadowRoot === null,
      styleColor: getComputedStyle(byStyle).color,
      stylePadding: getComputedStyle(byStyle).paddingTop,
    }

    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(".by-sheet { color: rgb(0, 0, 255); }")
      root.adoptedStyleSheets = [sheet]
      result.sheetColor = getComputedStyle(bySheet).color
    } catch (error) {
      result.sheetError = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      // Firefox 128 content scripts see the shadow root through an Xray wrapper, which refuses adoptedStyleSheets.
      // Build the sheet and the array in the page's realm and set them on the unwrapped root instead.
      const page = (window as any).wrappedJSObject
      if (page) {
        try {
          const sheet = new page.CSSStyleSheet()
          sheet.replaceSync(".by-sheet { color: rgb(0, 0, 255); }")
          ;(root as any).wrappedJSObject.adoptedStyleSheets = page.Array.of(sheet)
          result.sheetColorViaPageRealm = getComputedStyle(bySheet).color
        } catch (pageError) {
          result.sheetErrorViaPageRealm = String(pageError)
        }
      }
    }

    document.documentElement.dataset.dropSpike = JSON.stringify(result)
    return result
  },
})
