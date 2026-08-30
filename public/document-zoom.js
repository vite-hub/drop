const dialog = document.querySelector("#visual-zoom")
const content = dialog?.querySelector(".visual-zoom__content")

if (dialog && content) {
  const open = (visual) => {
    content.replaceChildren(visual.cloneNode(true))
    dialog.showModal()
  }

  for (const visual of document.querySelectorAll(".typeset img, .typeset [data-zoomable]")) {
    if (visual.closest("a")) continue

    visual.tabIndex = 0
    visual.setAttribute("role", "button")
    visual.setAttribute("aria-label", visual.alt ? `Zoom ${visual.alt}` : "Zoom visual")
    visual.addEventListener("click", () => open(visual))
    visual.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return
      event.preventDefault()
      open(visual)
    })
  }

  dialog.addEventListener("click", () => dialog.close())
  dialog.addEventListener("close", () => content.replaceChildren())
}
