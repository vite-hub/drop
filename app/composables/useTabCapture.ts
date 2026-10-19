/**
 * Screenshots of something Drop can't read itself, like a site in a frame on another origin: the browser's screen
 * capture, asked for once and kept open while the review lasts. Chromium offers "This tab", which captures exactly
 * the page. Firefox, Zen and Safari only share a window or a screen, so the page's place in the capture is worked out
 * from the window's size and position (toolbars and a sidebar assumed on the left and top); `exact` says which.
 */
export function useTabCapture() {
  const active = ref(false)
  /** The capture is this tab, so a crop lands exactly; otherwise it's a window or a screen and may be a little off. */
  const exact = ref(false)
  let stream: MediaStream | null = null
  let video: HTMLVideoElement | null = null

  const supported = () => import.meta.client && typeof navigator.mediaDevices?.getDisplayMedia === "function"

  async function start() {
    if (stream?.active) return
    // preferCurrentTab and selfBrowserSurface aren't in TypeScript's DOM types yet.
    const options = { video: { displaySurface: "browser" }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include", surfaceSwitching: "exclude" }
    stream = await navigator.mediaDevices.getDisplayMedia(options as DisplayMediaStreamOptions)
    const track = stream.getVideoTracks()[0]!
    track.addEventListener("ended", stop)
    exact.value = track.getSettings().displaySurface === "browser"
    video = document.createElement("video")
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await video.play()
    active.value = true
  }

  function stop() {
    stream?.getTracks().forEach(track => track.stop())
    stream = video = null
    active.value = false
  }

  /** Waits for a frame painted after now, so whatever was just hidden is gone from it. */
  function freshFrame(element: HTMLVideoElement) {
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 300)
      element.requestVideoFrameCallback?.(() => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }

  /** `area` (CSS pixels of this window's viewport) as an image, from the next frame of the capture. */
  async function grab(area: { left: number; top: number; width: number; height: number }): Promise<Blob> {
    if (!stream?.active || !video) throw new Error("The screen capture stopped. Press Comment to share again.")
    await freshFrame(video)
    const { videoWidth, videoHeight } = video
    const surface = stream.getVideoTracks()[0]!.getSettings().displaySurface
    // Where this window's viewport starts in the capture, and how many captured pixels make one CSS pixel.
    let left = 0, top = 0, scale = videoWidth / innerWidth
    if (surface === "window") {
      scale = videoWidth / outerWidth
      left = outerWidth - innerWidth
      top = outerHeight - innerHeight
    }
    else if (surface === "monitor") {
      scale = videoWidth / screen.width
      left = screenX + outerWidth - innerWidth
      top = screenY + outerHeight - innerHeight
    }
    const sx = Math.max(0, Math.round((left + area.left) * scale))
    const sy = Math.max(0, Math.round((top + area.top) * scale))
    const sw = Math.min(videoWidth - sx, Math.round(area.width * scale))
    const sh = Math.min(videoHeight - sy, Math.round(area.height * scale))
    if (sw < 1 || sh < 1) throw new Error("The shared window doesn't show this page. Share this tab or this window.")
    const canvas = document.createElement("canvas")
    canvas.width = sw
    canvas.height = sh
    canvas.getContext("2d")!.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh)
    // WebP keeps a full-screen capture well under the 4 MiB limit. Safari can't encode it and hands back a PNG; the
    // server reads the real type from the bytes.
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.9))
    if (!blob) throw new Error("Couldn't encode the screenshot.")
    return blob
  }

  onBeforeUnmount(stop)
  return { active, exact, supported, start, stop, grab }
}
