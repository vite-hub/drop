import { promiseTimeout } from "@vueuse/core"
const supported = () => import.meta.client && "mediaDevices" in navigator && "getDisplayMedia" in navigator.mediaDevices

function freshFrame(element: HTMLVideoElement) {
  return Promise.race([
    promiseTimeout(300),
    new Promise<void>((resolve) => element.requestVideoFrameCallback?.(() => resolve())),
  ])
}

export function useTabCapture() {
  const active = ref(false)
  const exact = ref(false)
  let stream: MediaStream | null = null
  let video: HTMLVideoElement | null = null

  async function start() {
    if (stream?.active) return
    const options = {
      video: { displaySurface: "browser" },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
    } as const
    stream = await navigator.mediaDevices.getDisplayMedia(options)
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
    stream?.getTracks().forEach((track) => track.stop())
    stream = video = null
    active.value = false
  }
  onScopeDispose(stop)

  async function grab(area: { left: number; top: number; width: number; height: number }): Promise<Blob> {
    if (!stream?.active || !video) throw new Error("The screen capture stopped. Press Comment to share again.")
    await freshFrame(video)
    const { videoWidth, videoHeight } = video
    const surface = stream.getVideoTracks()[0]!.getSettings().displaySurface
    let left = 0,
      top = 0,
      scale = videoWidth / innerWidth
    if (surface === "window") {
      scale = videoWidth / outerWidth
      left = outerWidth - innerWidth
      top = outerHeight - innerHeight
    } else if (surface === "monitor") {
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
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9))
    if (!blob) throw new Error("Couldn't encode the screenshot.")
    return blob
  }

  onBeforeUnmount(stop)
  return { active, exact, supported, start, stop, grab }
}
