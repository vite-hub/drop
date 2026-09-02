for (const svg of document.querySelectorAll(".mermaid svg")) {
  const image = document.createElement("img")
  image.alt = "Mermaid diagram"
  image.className = "mermaid-image"
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.outerHTML)}`
  svg.replaceWith(image)
}

const visuals = [...document.querySelectorAll(".typeset img:not(a img)")]
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
