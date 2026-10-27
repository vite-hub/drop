// comark-zoom zooms its own blocks ([data-zoom]): Mermaid diagrams and annotated screenshots.
const visuals = [...document.querySelectorAll(".typeset img:not(a img, [data-zoom] img)")]
const zoom = window.mediumZoom(visuals, {
  background: "#fff",
  margin: 24,
})

for (const visual of visuals) {
  visual.tabIndex = 0
  visual.setAttribute("role", "button")
  visual.setAttribute("aria-label", visual.alt ? `Zoom ${visual.alt}` : "Zoom image")
  visual.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return
    event.preventDefault()
    zoom.open({ target: visual })
  })
}
